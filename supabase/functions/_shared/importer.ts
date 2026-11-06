// Imports a chosen image, and replaces, deletes or promotes product images.
import { analyze, decodeImage, fetchImageBytes, hamming, makeProductImage, makeThumbnail } from "./imaging.ts";

const DUPLICATE_DISTANCE_IMPORT = 6;
const fetchImageBytesSafe = (f: typeof fetch, url: string) => fetchImageBytes(f, url, 25000);
import { attributionFor, getById, Keys, Provider, PROVIDERS, trackUnsplashDownload, unsplashSized } from "./providers.ts";

export interface ProductRow { id: string; name: string; category: string }
export interface ImageRow {
  id: string; product_id: string; product_name: string; category: string; provider: Provider; provider_image_id: string;
  hosting: "self" | "hotlink"; image_url: string; thumb_url: string; storage_full_path: string | null; storage_thumb_path: string | null;
  source_page_url: string; photographer: string | null; photographer_url: string | null; license: string; attribution: string;
  width: number | null; height: number | null; phash: string | null; color_hex: string | null; is_primary: boolean; created_at?: string;
}

// Storage and database operations, supplied by the edge function (Supabase) or by tests (in memory).
export interface Store {
  getProduct(id: string): Promise<ProductRow | null>;
  listImages(productId?: string): Promise<ImageRow[]>;
  getImage(id: string): Promise<ImageRow | null>;
  insertImage(row: Omit<ImageRow, "id" | "created_at">): Promise<ImageRow>;
  updateImage(id: string, patch: Partial<ImageRow>): Promise<void>;
  deleteImage(id: string): Promise<void>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<string>; // returns public URL
  remove(paths: string[]): Promise<void>;
}

export class ImportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ImportInput { productId: string; provider: Provider; providerImageId: string; makePrimary?: boolean }

export async function importImage(input: ImportInput, deps: { fetch: typeof fetch; keys: Keys; store: Store }): Promise<ImageRow> {
  const { store } = deps;
  if (!PROVIDERS.includes(input.provider)) throw new ImportError(400, "Unknown image provider.");
  const product = await store.getProduct(input.productId);
  if (!product) throw new ImportError(404, "Product not found.");

  const all = await store.listImages();
  const mine = all.filter((i) => i.product_id === product.id);
  if (mine.some((i) => i.provider === input.provider && i.provider_image_id === input.providerImageId)) {
    throw new ImportError(409, "This image is already added to the product.");
  }

  // Look the image up again on the provider's API. Browser supplied URLs are never used.
  const meta = await getById(deps.fetch, deps.keys, input.provider, input.providerImageId);

  const assertNotDuplicate = (hash: string) => {
    const dup = all.find((i) => i.phash && hamming(i.phash, hash) <= DUPLICATE_DISTANCE_IMPORT);
    if (dup) throw new ImportError(409, `Duplicate image. A near identical photo is already used on product ${dup.product_id}.`);
  };

  const base = {
    product_id: product.id, product_name: product.name, category: product.category,
    provider: meta.provider, provider_image_id: meta.id, source_page_url: meta.pageUrl,
    photographer: meta.photographer, photographer_url: meta.photographerUrl,
    license: meta.license, attribution: attributionFor(meta),
    is_primary: input.makePrimary ?? mine.length === 0,
  };

  if (meta.provider === "unsplash") {
    // Unsplash API rule: hotlink from Unsplash, keep ixid, and trigger the download event.
    const image_url = unsplashSized(meta.sourceUrl, { w: 1600, q: 80, fm: "jpg", fit: "max" });
    const thumb_url = unsplashSized(meta.sourceUrl, { w: 480, h: 640, fit: "crop", crop: "entropy", q: 76, fm: "jpg" });
    const img = await decodeImage(await fetchImageBytesSafe(deps.fetch, thumb_url));
    const a = analyze(img);
    assertNotDuplicate(a.hash);
    await trackUnsplashDownload(deps.fetch, deps.keys, meta);
    if (base.is_primary) await clearPrimary(store, product.id);
    return await store.insertImage({ ...base, hosting: "hotlink", image_url, thumb_url, storage_full_path: null, storage_thumb_path: null,
      width: meta.width, height: meta.height, phash: a.hash, color_hex: a.subjectHex });
  }

  // Pexels and Pixabay: download, check, optimize and store in our own bucket.
  const img = await decodeImage(await fetchImageBytesSafe(deps.fetch, meta.sourceUrl));
  if (Math.min(img.width, img.height) < 500) throw new ImportError(422, "Image resolution is too low for a product photo.");
  const a = analyze(img);
  assertNotDuplicate(a.hash);
  const full = await makeProductImage(img);
  const thumb = await makeThumbnail(img);
  const stem = `${product.id}/${meta.provider}-${meta.id}`;
  const fullPath = `${stem}-full.jpg`, thumbPath = `${stem}-thumb.jpg`;
  const image_url = await store.upload(fullPath, full, "image/jpeg");
  const thumb_url = await store.upload(thumbPath, thumb, "image/jpeg");
  try {
    if (base.is_primary) await clearPrimary(store, product.id);
    return await store.insertImage({ ...base, hosting: "self", image_url, thumb_url, storage_full_path: fullPath, storage_thumb_path: thumbPath,
      width: img.width, height: img.height, phash: a.hash, color_hex: a.subjectHex });
  } catch (e) {
    await store.remove([fullPath, thumbPath]);
    throw e;
  }
}

async function clearPrimary(store: Store, productId: string) {
  for (const i of await store.listImages(productId)) if (i.is_primary) await store.updateImage(i.id, { is_primary: false });
}

export async function setPrimary(imageId: string, store: Store): Promise<void> {
  const img = await store.getImage(imageId);
  if (!img) throw new ImportError(404, "Image not found.");
  await clearPrimary(store, img.product_id);
  await store.updateImage(img.id, { is_primary: true });
}

export async function deleteImage(imageId: string, store: Store): Promise<void> {
  const img = await store.getImage(imageId);
  if (!img) throw new ImportError(404, "Image not found.");
  await store.deleteImage(img.id);
  if (img.hosting === "self") await store.remove([img.storage_full_path, img.storage_thumb_path].filter(Boolean) as string[]);
  if (img.is_primary) {
    const rest = (await store.listImages(img.product_id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (rest[0]) await store.updateImage(rest[0].id, { is_primary: true });
  }
}

export async function replaceImage(imageId: string, provider: Provider, providerImageId: string, deps: { fetch: typeof fetch; keys: Keys; store: Store }) {
  const old = await deps.store.getImage(imageId);
  if (!old) throw new ImportError(404, "Image not found.");
  const fresh = await importImage({ productId: old.product_id, provider, providerImageId, makePrimary: false }, deps);
  await deleteImage(old.id, deps.store);
  if (old.is_primary) await setPrimary(fresh.id, deps.store);
  return { ...fresh, is_primary: old.is_primary };
}

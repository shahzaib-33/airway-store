// Tests the search, scoring, filtering and import logic with fake provider APIs.
// Run: deno test -A tests/functions
import { assert, assertEquals, assertRejects } from "./assert.ts";
import { Image, decode } from "npm:imagescript@1.3.0";
import { runSearch, buildQuery } from "../../supabase/functions/_shared/search.ts";
import { importImage, deleteImage, setPrimary, replaceImage, ImageRow, Store, ImportError } from "../../supabase/functions/_shared/importer.ts";
import { ImageError } from "../../supabase/functions/_shared/imaging.ts";

// ---------- synthetic photos ----------
type Spec = { w: number; h: number; bg: number; fg: number; noisy?: boolean; box?: [number, number, number, number]; stripe?: number };
async function jpeg(s: Spec): Promise<Uint8Array> {
  const img = new Image(s.w, s.h);
  img.fill(s.bg);
  if (s.noisy) {
    for (let y = 1; y <= s.h; y += 3) for (let x = 1; x <= s.w; x += 3) {
      const v = (Math.sin(x * 0.37) * Math.cos(y * 0.23) * 0.5 + 0.5) * 255;
      img.drawBox(x, y, 3, 3, Image.rgbaToColor(v, 255 - v, (x * y) % 255, 255));
    }
  }
  const [bx, by, bw, bh] = s.box ?? [0.3, 0.2, 0.4, 0.6];
  img.drawBox(Math.round(s.w * bx), Math.round(s.h * by), Math.round(s.w * bw), Math.round(s.h * bh), s.fg);
  if (s.stripe) img.drawBox(Math.round(s.w * 0.1), Math.round(s.h * 0.1), Math.round(s.w * 0.15), Math.round(s.h * 0.8), s.stripe);
  return await img.encodeJPEG(90);
}
const C = (r: number, g: number, b: number) => Image.rgbaToColor(r, g, b, 255);
const WHITE_BG = C(250, 250, 250), WHITE_SHIRT = C(236, 236, 232), BLACK = C(20, 20, 20);

const IMAGES: Record<string, Uint8Array | "404" | "garbage"> = {};
async function setupImages() {
  // shirt on plain light grey background (product shot) at two sizes
  IMAGES["https://img/p1-preview.jpg"] = await jpeg({ w: 280, h: 350, bg: C(215, 215, 220), fg: WHITE_SHIRT });
  IMAGES["https://img/p1-large.jpg"] = await jpeg({ w: 2000, h: 2600, bg: C(215, 215, 220), fg: WHITE_SHIRT });
  // person in white shirt on busy street
  IMAGES["https://img/p2-preview.jpg"] = await jpeg({ w: 280, h: 350, bg: WHITE_BG, fg: WHITE_SHIRT, noisy: true, box: [0.35, 0.3, 0.3, 0.4] });
  IMAGES["https://img/p3-preview.jpg"] = "404";
  IMAGES["https://img/p4-preview.jpg"] = await jpeg({ w: 280, h: 350, bg: WHITE_BG, fg: WHITE_SHIRT });
  IMAGES["https://img/p5-preview.jpg"] = await jpeg({ w: 280, h: 350, bg: WHITE_BG, fg: WHITE_SHIRT });
  // u1: same photo as p1 (duplicate across providers)
  IMAGES["https://img/u1-small.jpg"] = IMAGES["https://img/p1-preview.jpg"];
  // u2: black shirt flat lay (right type, wrong color)
  IMAGES["https://img/u2-small.jpg"] = await jpeg({ w: 400, h: 500, bg: WHITE_BG, fg: BLACK, box: [0.2, 0.15, 0.6, 0.7] });
  IMAGES["https://img/u3-small.jpg"] = await jpeg({ w: 400, h: 500, bg: WHITE_BG, fg: BLACK });
  // x1: different white shirt photo with a dark seam stripe, on a light blue backdrop
  IMAGES["https://img/x1-web.jpg"] = await jpeg({ w: 640, h: 800, bg: C(180, 200, 230), fg: C(238, 238, 236), box: [0.45, 0.05, 0.5, 0.9], stripe: C(80, 80, 90) });
  IMAGES["https://img/x1-large.jpg"] = await jpeg({ w: 1280, h: 1600, bg: C(180, 200, 230), fg: C(238, 238, 236), box: [0.45, 0.05, 0.5, 0.9], stripe: C(80, 80, 90) });
  IMAGES["https://img/x2-web.jpg"] = "garbage";
  // Unsplash hotlink sizes for u2
  IMAGES["https://images.unsplash.com/photo-u2"] = await jpeg({ w: 480, h: 640, bg: WHITE_BG, fg: BLACK, box: [0.2, 0.15, 0.6, 0.7] });
}

const pexelsPhoto = (id: number, alt: string, w = 3000, h = 4000) => ({
  id, width: w, height: h, url: `https://www.pexels.com/photo/${id}/`, photographer: `Pex ${id}`, photographer_url: `https://www.pexels.com/@p${id}`,
  avg_color: null, alt, src: { medium: `https://img/p${id}-preview.jpg`, large2x: `https://img/p${id}-large.jpg` },
});
const unsplashPhoto = (id: string, alt: string, tags: string[] = []) => ({
  id, width: 3000, height: 4000, color: null, alt_description: alt, description: null, tags: tags.map((t) => ({ title: t })),
  urls: { small: `https://img/${id}-small.jpg`, raw: `https://images.unsplash.com/photo-${id}?ixid=TRACK123&ixlib=rb-4.0.3` },
  links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=TRACK123` },
  user: { name: `Uns ${id}`, links: { html: `https://unsplash.com/@${id}` } },
});
const pixabayHit = (id: string, tags: string) => ({
  id, imageWidth: 4000, imageHeight: 5000, pageURL: `https://pixabay.com/photos/${id}/`, user: `pix${id}`, user_id: 7, tags,
  webformatURL: `https://img/${id}-web.jpg`, largeImageURL: `https://img/${id}-large.jpg`,
});

const PEXELS = [pexelsPhoto(1, "White shirt on a hanger, isolated on a plain background"), pexelsPhoto(2, "Smiling woman in a white shirt walking on the street"),
  pexelsPhoto(3, "White cotton shirt"), pexelsPhoto(4, "White Nike shirt with logo"), pexelsPhoto(5, "White shirt", 400, 500)];
const UNSPLASH = [unsplashPhoto("u1", "white shirt"), unsplashPhoto("u2", "black shirt flat lay", ["shirt", "clothing"]), unsplashPhoto("u3", "pair of shoes on floor", ["shoes"])];
const PIXABAY = [pixabayHit("x1", "shirt, white, clothing, hanger"), pixabayHit("x2", "dress shirt, white")];

const calls: string[] = [];
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  const j = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.pexels.com/v1/search")) return j({ photos: PEXELS });
  if (url.startsWith("https://api.pexels.com/v1/photos/")) return j(PEXELS.find((p) => url.endsWith(`/${p.id}`)));
  if (url.startsWith("https://api.unsplash.com/search/photos")) return j({ results: UNSPLASH });
  if (url.includes("/download?ixid=")) return j({ url: "ok" });
  if (url.startsWith("https://api.unsplash.com/photos/")) return j(UNSPLASH.find((u) => url.endsWith(`/${u.id}`)));
  if (url.startsWith("https://pixabay.com/api/") && url.includes("&id=")) return j({ hits: PIXABAY.filter((h) => url.includes(`&id=${h.id}`)) });
  if (url.startsWith("https://pixabay.com/api/")) return j({ hits: PIXABAY });
  const key = url.startsWith("https://images.unsplash.com/photo-u2") ? "https://images.unsplash.com/photo-u2" : url;
  const v = IMAGES[key];
  if (!v || v === "404") return new Response("nope", { status: 404 });
  if (v === "garbage") return new Response(new Uint8Array(2000).fill(7), { headers: { "content-type": "image/jpeg" } });
  return new Response(v as unknown as BodyInit, { headers: { "content-type": "image/jpeg", "content-length": String(v.byteLength) } });
};
const KEYS = { pexels: "k", unsplash: "k", pixabay: "k", unsplashAppName: "airway_test" };

// ---------- in memory store ----------
function memStore(): Store & { rows: ImageRow[]; files: Map<string, Uint8Array> } {
  const rows: ImageRow[] = [], files = new Map<string, Uint8Array>();
  const products = [{ id: "s1", name: "Oxford Shirt", category: "mens_shirts" }, { id: "s9", name: "White Tee", category: "tshirts" }];
  let n = 0;
  return {
    rows, files,
    getProduct: async (id) => products.find((p) => p.id === id) ?? null,
    listImages: async (pid) => rows.filter((r) => !pid || r.product_id === pid).map((r) => ({ ...r })),
    getImage: async (id) => rows.find((r) => r.id === id) ?? null,
    insertImage: async (row) => {
      if (row.is_primary && rows.some((r) => r.product_id === row.product_id && r.is_primary)) throw new Error("one primary violated");
      const r = { ...row, id: `img${++n}`, created_at: new Date(Date.now() + n * 1000).toISOString() } as ImageRow; rows.push(r); return r;
    },
    updateImage: async (id, patch) => {
      const r = rows.find((x) => x.id === id)!; Object.assign(r, patch);
      if (rows.filter((x) => x.product_id === r.product_id && x.is_primary).length > 1) throw new Error("one primary violated");
    },
    deleteImage: async (id) => { rows.splice(rows.findIndex((r) => r.id === id), 1); },
    upload: async (path, bytes) => { files.set(path, bytes); return `https://cdn.test/product-images/${path}`; },
    remove: async (paths) => { paths.forEach((p) => files.delete(p)); },
  };
}

Deno.test("query uses product color and type", () => {
  const q = buildQuery({ name: "Oxford Shirt", category: "mens_shirts", color: "white" });
  assertEquals(q.query, "white oxford");
  assertEquals(buildQuery({ name: "Black Leather Belt", category: "accessories" }).query, "black belt");
});

Deno.test("search keeps matching product photos and rejects bad ones", async () => {
  await setupImages();
  const r = await runSearch({ name: "Oxford Shirt", category: "mens_shirts", color: "white" }, { fetch: fakeFetch, keys: KEYS, existingImages: async () => [] });
  const ids = r.results.map((c) => c.id);
  const why = Object.fromEntries(r.rejected.map((x) => [x.id, x.reason]));
  console.log("kept:", r.results.map((c) => `${c.id}:${c.score} ${c.reasons.join(", ")}`));
  console.log("rejected:", why);
  assertEquals(r.providers.pexels.ok && r.providers.unsplash.ok && r.providers.pixabay.ok, true);
  assert(ids.includes("1") && ids.includes("x1"), "good product shots kept");
  assertEquals(ids[0] === "1" || ids[0] === "x1", true, "best match ranked first");
  assert(!ids.includes("2"), "person photo rejected"); assert(why["2"]);
  assert(why["3"]?.startsWith("Broken"), "404 image rejected");
  assert(why["4"]?.includes("Branded"), "brand logo rejected");
  assert(why["5"]?.includes("Resolution"), "low resolution rejected");
  assert(why["u1"]?.includes("Duplicate"), "cross provider duplicate rejected");
  assert(why["u3"]?.includes("not men"), "shoes rejected for shirt search");
  assert(why["x2"]?.startsWith("Broken"), "corrupt file rejected");
  if (ids.includes("u2")) assert(r.results.find((c) => c.id === "u2")!.score < r.results.find((c) => c.id === "1")!.score, "wrong color ranks lower");
  for (const c of r.results) assert(c.score >= 40);
});

Deno.test("search skips images already used in the store", async () => {
  await setupImages();
  const first = await runSearch({ name: "Oxford Shirt", category: "mens_shirts", color: "white" }, { fetch: fakeFetch, keys: KEYS, existingImages: async () => [] });
  const p1 = first.results.find((c) => c.id === "1")!;
  const r = await runSearch({ name: "White Tee", category: "mens_shirts", color: "white" }, {
    fetch: fakeFetch, keys: KEYS, existingImages: async () => [{ product_id: "s1", provider: "pexels", provider_image_id: "1", phash: p1.hash }],
  });
  assert(!r.results.some((c) => c.id === "1"));
  assert(r.rejected.find((x) => x.id === "1")!.reason.includes("already used"));
});

Deno.test("missing API key is reported, other providers still work", async () => {
  await setupImages();
  const r = await runSearch({ name: "Oxford Shirt", category: "mens_shirts", color: "white" }, { fetch: fakeFetch, keys: { pexels: "k" }, existingImages: async () => [] });
  assertEquals(r.providers.unsplash.ok, false);
  assert(r.providers.unsplash.message!.includes("key"));
  assert(r.results.length > 0);
});

Deno.test("Pexels import downloads, optimizes, stores and saves the row", async () => {
  await setupImages();
  const store = memStore();
  const row = await importImage({ productId: "s1", provider: "pexels", providerImageId: "1" }, { fetch: fakeFetch, keys: KEYS, store });
  assertEquals(row.hosting, "self");
  assertEquals(row.is_primary, true);
  assertEquals(row.product_name, "Oxford Shirt");
  assertEquals(row.category, "mens_shirts");
  assertEquals(row.attribution, "Photo by Pex 1 on Pexels");
  assertEquals(row.image_url, "https://cdn.test/product-images/s1/pexels-1-full.jpg");
  const full = await decode(store.files.get("s1/pexels-1-full.jpg")!) as Image;
  const thumb = await decode(store.files.get("s1/pexels-1-thumb.jpg")!) as Image;
  assertEquals(Math.max(full.width, full.height), 1600);
  assertEquals([thumb.width, thumb.height], [480, 640]);
  assert(store.files.get("s1/pexels-1-thumb.jpg")!.byteLength < IMAGES["https://img/p1-large.jpg"]!.length);
  await assertRejects(() => importImage({ productId: "s1", provider: "pexels", providerImageId: "1" }, { fetch: fakeFetch, keys: KEYS, store }), ImportError, "already added");
  await assertRejects(() => importImage({ productId: "s9", provider: "unsplash", providerImageId: "u1" }, { fetch: fakeFetch, keys: KEYS, store }), Error);
});

Deno.test("Unsplash import hotlinks, keeps ixid and triggers the download event", async () => {
  await setupImages();
  const store = memStore();
  calls.length = 0;
  const row = await importImage({ productId: "s1", provider: "unsplash", providerImageId: "u2" }, { fetch: fakeFetch, keys: KEYS, store });
  assertEquals(row.hosting, "hotlink");
  assertEquals(store.files.size, 0);
  assert(row.image_url.includes("ixid=TRACK123") && row.image_url.includes("w=1600"));
  assert(row.thumb_url.includes("ixid=TRACK123") && row.thumb_url.includes("h=640"));
  assert(calls.some((u) => u.includes("/photos/u2/download?ixid=TRACK123")), "download_location called");
  assert(row.photographer_url!.includes("utm_source=airway_test"));
  assertEquals(row.attribution, "Photo by Uns u2 on Unsplash");
});

Deno.test("broken source image is never imported", async () => {
  await setupImages();
  const store = memStore();
  await assertRejects(() => importImage({ productId: "s1", provider: "pixabay", providerImageId: "x2" }, { fetch: fakeFetch, keys: KEYS, store }), ImageError);
  assertEquals(store.rows.length, 0);
  assertEquals(store.files.size, 0);
});

Deno.test("admin actions: set primary, replace and delete", async () => {
  await setupImages();
  const store = memStore();
  const deps = { fetch: fakeFetch, keys: KEYS, store };
  const a = await importImage({ productId: "s1", provider: "pexels", providerImageId: "1" }, deps);
  const b = await importImage({ productId: "s1", provider: "pixabay", providerImageId: "x1" }, deps);
  assertEquals(b.is_primary, false);
  await setPrimary(b.id, store);
  assertEquals(store.rows.find((r) => r.id === b.id)!.is_primary, true);
  assertEquals(store.rows.find((r) => r.id === a.id)!.is_primary, false);
  // replace the primary with an Unsplash photo, primary flag moves to the new one
  const c = await replaceImage(b.id, "unsplash", "u2", deps);
  assertEquals(store.rows.find((r) => r.id === c.id)!.is_primary, true);
  assert(!store.rows.some((r) => r.id === b.id));
  assert(!store.files.has("s1/pixabay-x1-full.jpg"), "replaced files removed");
  // delete the primary, the remaining image is promoted and its files stay
  await deleteImage(c.id, store);
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].is_primary, true);
  assert(store.files.has("s1/pexels-1-full.jpg"));
  await deleteImage(a.id, store);
  assertEquals(store.files.size, 0);
});

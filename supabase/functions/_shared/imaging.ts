// Image decoding, checks, fingerprints and resizing. Pure TypeScript, runs in Supabase Edge Functions.
import { decode, Image } from "npm:imagescript@1.3.0";
import { RGB, rgbToHex } from "./colors.ts";

export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

export class ImageError extends Error {
  constructor(public code: "broken" | "too_small" | "too_large" | "not_image" | "timeout", message: string) { super(message); }
}

type Fetch = typeof fetch;

// Download bytes and make sure they really are an image.
export async function fetchImageBytes(fetchFn: Fetch, url: string, timeoutMs = 15000): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { "User-Agent": "AirwayStore-ImageImporter/1.0" } });
    if (!res.ok) throw new ImageError("broken", `Image request failed with status ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|jpg|png|webp)/i.test(type)) throw new ImageError("not_image", `Not a supported image (${type || "unknown type"})`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_DOWNLOAD_BYTES) throw new ImageError("too_large", "Image file is too large");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 500) throw new ImageError("broken", "Image file is empty or truncated");
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) throw new ImageError("too_large", "Image file is too large");
    return buf;
  } catch (e) {
    if (e instanceof ImageError) throw e;
    if ((e as Error).name === "AbortError") throw new ImageError("timeout", "Image download timed out");
    throw new ImageError("broken", `Image could not be downloaded: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function decodeImage(bytes: Uint8Array): Promise<Image> {
  try {
    const img = await decode(bytes, true);
    if (!(img instanceof Image) || img.width < 8 || img.height < 8) throw new Error("bad image");
    return img;
  } catch {
    throw new ImageError("broken", "Image data is corrupt or unreadable");
  }
}

// 64 bit difference hash. Near identical photos give near identical hashes.
export function dHash(img: Image): string {
  const s = img.clone().resize(9, 8);
  let bits = 0n;
  for (let y = 1; y <= 8; y++) {
    for (let x = 1; x <= 8; x++) {
      const a = lum(s.getPixelAt(x, y)), b = lum(s.getPixelAt(x + 1, y));
      bits = (bits << 1n) | (a > b ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}
const lum = (rgba: number) => 0.299 * ((rgba >>> 24) & 255) + 0.587 * ((rgba >>> 16) & 255) + 0.114 * ((rgba >>> 8) & 255);

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export interface Analysis {
  width: number; height: number; hash: string;
  subjectColor: RGB; subjectHex: string;
  backgroundPlain: boolean; backgroundLight: boolean;
}

// Looks at the picture: what color is the item in the middle, and is the background plain like a product shot.
export function analyze(img: Image): Analysis {
  const w = img.width, h = img.height;
  const scale = Math.min(1, 160 / Math.max(w, h));
  const s = scale < 1 ? img.clone().resize(Math.max(8, Math.round(w * scale)), Math.max(8, Math.round(h * scale))) : img;
  const W = s.width, H = s.height, px = s.bitmap;
  const at = (x: number, y: number): RGB => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };

  const border: RGB[] = [];
  const bw = Math.max(1, Math.round(W * 0.06)), bh = Math.max(1, Math.round(H * 0.06));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < bw || x >= W - bw || y < bh || y >= H - bh) border.push(at(x, y));
  }
  const mean = (arr: RGB[]): RGB => {
    const t = arr.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]] as RGB, [0, 0, 0] as RGB);
    return [t[0] / arr.length, t[1] / arr.length, t[2] / arr.length];
  };
  const bg = mean(border);
  const spread = Math.sqrt(border.reduce((a, c) => a + (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2, 0) / border.length);

  const center: RGB[] = [], subject: RGB[] = [];
  for (let y = Math.round(H * 0.15); y < Math.round(H * 0.85); y++) for (let x = Math.round(W * 0.15); x < Math.round(W * 0.85); x++) {
    const c = at(x, y); center.push(c);
    if (Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) > 45) subject.push(c);
  }
  const subj = subject.length > center.length * 0.06 ? mean(subject) : mean(center);
  return {
    width: w, height: h, hash: dHash(img),
    subjectColor: subj, subjectHex: rgbToHex(subj),
    backgroundPlain: spread < 22,
    backgroundLight: (bg[0] + bg[1] + bg[2]) / 3 > 200,
  };
}

// Optimized store image: long side at most 1600px, JPEG quality 82.
export async function makeProductImage(img: Image): Promise<Uint8Array> {
  const long = Math.max(img.width, img.height);
  const out = long > 1600 ? img.clone().resize(img.width >= img.height ? 1600 : Image.RESIZE_AUTO, img.width >= img.height ? Image.RESIZE_AUTO : 1600) : img.clone();
  return await out.encodeJPEG(82);
}

// Thumbnail: 480 x 640 (3:4, same shape as store tiles), center crop, JPEG quality 76.
export async function makeThumbnail(img: Image): Promise<Uint8Array> {
  return await img.clone().cover(480, 640).encodeJPEG(76);
}

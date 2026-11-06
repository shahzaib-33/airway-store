// Pexels, Unsplash and Pixabay API clients, normalized to one shape.
// Each follows its provider's API rules (see README "Licensing and attribution").
import { LICENSES } from "./catalog.ts";
import { providerColor } from "./colors.ts";

export type Provider = "pexels" | "unsplash" | "pixabay";
export const PROVIDERS: Provider[] = ["pexels", "unsplash", "pixabay"];

export interface Candidate {
  provider: Provider;
  id: string;
  previewUrl: string;      // small image for analysis and the admin picker (temporary display)
  sourceUrl: string;       // larger image to import (self hosted) or hotlink base (Unsplash raw)
  width: number;
  height: number;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  text: string;            // alt text, description and tags, lower case
  providerColor?: string;
  license: string;
  licenseUrl: string;
  downloadLocation?: string; // Unsplash only
}

export interface Keys { pexels?: string; unsplash?: string; pixabay?: string; unsplashAppName?: string }
export class ProviderError extends Error {
  constructor(public provider: Provider, public status: number, message: string) { super(message); }
}

type Fetch = typeof fetch;

async function getJSON(fetchFn: Fetch, provider: Provider, url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetchFn(url, { headers: { Accept: "application/json", ...headers }, signal: ctrl.signal });
    if (res.status === 429) throw new ProviderError(provider, 429, `${provider} rate limit reached. Try again later.`);
    if (res.status === 401 || res.status === 403) throw new ProviderError(provider, res.status, `${provider} API key was rejected.`);
    if (!res.ok) throw new ProviderError(provider, res.status, `${provider} returned status ${res.status}.`);
    return await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(provider, 0, `${provider} could not be reached.`);
  } finally { clearTimeout(t); }
}

// ---------------- Pexels ----------------
// deno-lint-ignore no-explicit-any
const fromPexels = (p: any): Candidate => ({
  provider: "pexels", id: String(p.id),
  previewUrl: p.src?.medium, sourceUrl: p.src?.large2x ?? p.src?.original,
  width: p.width, height: p.height, pageUrl: p.url,
  photographer: p.photographer ?? "Unknown", photographerUrl: p.photographer_url ?? "https://www.pexels.com",
  text: String(p.alt ?? "").toLowerCase(), providerColor: p.avg_color ?? undefined,
  license: LICENSES.pexels.name, licenseUrl: LICENSES.pexels.url,
});

// ---------------- Unsplash ----------------
const utm = (url: string, app: string) => `${url}${url.includes("?") ? "&" : "?"}utm_source=${encodeURIComponent(app)}&utm_medium=referral`;
// deno-lint-ignore no-explicit-any
const fromUnsplash = (r: any, app: string): Candidate => ({
  provider: "unsplash", id: String(r.id),
  previewUrl: r.urls?.small, sourceUrl: r.urls?.raw,
  width: r.width, height: r.height, pageUrl: utm(r.links?.html ?? "https://unsplash.com", app),
  photographer: r.user?.name ?? "Unknown", photographerUrl: utm(r.user?.links?.html ?? "https://unsplash.com", app),
  text: [r.alt_description, r.description, ...(r.tags ?? []).map((t: { title: string }) => t.title)].filter(Boolean).join(" ").toLowerCase(),
  providerColor: r.color ?? undefined,
  license: LICENSES.unsplash.name, licenseUrl: LICENSES.unsplash.url,
  downloadLocation: r.links?.download_location,
});

// ---------------- Pixabay ----------------
// deno-lint-ignore no-explicit-any
const fromPixabay = (h: any): Candidate => ({
  provider: "pixabay", id: String(h.id),
  previewUrl: h.webformatURL, sourceUrl: h.largeImageURL ?? h.webformatURL,
  width: h.imageWidth, height: h.imageHeight, pageUrl: h.pageURL,
  photographer: h.user ?? "Unknown", photographerUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
  text: String(h.tags ?? "").toLowerCase(),
  license: LICENSES.pixabay.name, licenseUrl: LICENSES.pixabay.url,
});

export async function searchProvider(fetchFn: Fetch, keys: Keys, provider: Provider, query: string, color?: string, perPage = 20): Promise<Candidate[]> {
  const q = encodeURIComponent(query.slice(0, 100));
  if (provider === "pexels") {
    if (!keys.pexels) throw new ProviderError("pexels", 0, "Pexels API key is not set.");
    const c = providerColor("pexels", color);
    const d = await getJSON(fetchFn, "pexels", `https://api.pexels.com/v1/search?query=${q}&per_page=${perPage}${c ? `&color=${c}` : ""}`, { Authorization: keys.pexels });
    return (d.photos ?? []).map(fromPexels);
  }
  if (provider === "unsplash") {
    if (!keys.unsplash) throw new ProviderError("unsplash", 0, "Unsplash API key is not set.");
    const c = providerColor("unsplash", color);
    const d = await getJSON(fetchFn, "unsplash", `https://api.unsplash.com/search/photos?query=${q}&per_page=${perPage}&content_filter=high${c ? `&color=${c}` : ""}`,
      { Authorization: `Client-ID ${keys.unsplash}`, "Accept-Version": "v1" });
    return (d.results ?? []).map((r: unknown) => fromUnsplash(r, keys.unsplashAppName ?? "airway_store"));
  }
  if (!keys.pixabay) throw new ProviderError("pixabay", 0, "Pixabay API key is not set.");
  const c = providerColor("pixabay", color);
  const d = await getJSON(fetchFn, "pixabay",
    `https://pixabay.com/api/?key=${encodeURIComponent(keys.pixabay)}&q=${q}&image_type=photo&safesearch=true&per_page=${perPage}${c ? `&colors=${c}` : ""}`);
  return (d.hits ?? []).map(fromPixabay);
}

// Server side lookup by id. Imports never trust image URLs sent from the browser.
export async function getById(fetchFn: Fetch, keys: Keys, provider: Provider, id: string): Promise<Candidate> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ProviderError(provider, 400, "Invalid image id.");
  if (provider === "pexels") {
    if (!keys.pexels) throw new ProviderError("pexels", 0, "Pexels API key is not set.");
    return fromPexels(await getJSON(fetchFn, "pexels", `https://api.pexels.com/v1/photos/${id}`, { Authorization: keys.pexels }));
  }
  if (provider === "unsplash") {
    if (!keys.unsplash) throw new ProviderError("unsplash", 0, "Unsplash API key is not set.");
    return fromUnsplash(await getJSON(fetchFn, "unsplash", `https://api.unsplash.com/photos/${id}`,
      { Authorization: `Client-ID ${keys.unsplash}`, "Accept-Version": "v1" }), keys.unsplashAppName ?? "airway_store");
  }
  if (!keys.pixabay) throw new ProviderError("pixabay", 0, "Pixabay API key is not set.");
  const d = await getJSON(fetchFn, "pixabay", `https://pixabay.com/api/?key=${encodeURIComponent(keys.pixabay)}&id=${id}`);
  if (!d.hits?.length) throw new ProviderError("pixabay", 404, "Pixabay image not found.");
  return fromPixabay(d.hits[0]);
}

// Unsplash requires this call whenever an image is chosen for use.
export async function trackUnsplashDownload(fetchFn: Fetch, keys: Keys, c: Candidate): Promise<void> {
  if (c.provider !== "unsplash" || !c.downloadLocation) return;
  await getJSON(fetchFn, "unsplash", c.downloadLocation, { Authorization: `Client-ID ${keys.unsplash}`, "Accept-Version": "v1" });
}

// Unsplash images are hotlinked. Sizes come from Unsplash's own resizing parameters; ixid is kept.
export function unsplashSized(raw: string, params: Record<string, string | number>): string {
  const u = new URL(raw);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export function attributionFor(c: Candidate): string {
  if (c.provider === "pexels") return `Photo by ${c.photographer} on Pexels`;
  if (c.provider === "unsplash") return `Photo by ${c.photographer} on Unsplash`;
  return `Image by ${c.photographer} from Pixabay`;
}

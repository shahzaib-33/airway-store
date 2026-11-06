// Builds the search, asks every provider, then checks, scores and de-duplicates the results.
import { anyWord, BLOCK_WORDS, CATEGORIES, Category, conflictTerms, PEOPLE_WORDS, PRODUCT_WORDS } from "./catalog.ts";
import { colorRGB, deltaE, findColorName, hexToRgb, RGB } from "./colors.ts";
import { analyze, decodeImage, fetchImageBytes, hamming } from "./imaging.ts";
import { Candidate, Keys, Provider, ProviderError, PROVIDERS, searchProvider } from "./providers.ts";

export const MIN_SCORE = 40;
export const MIN_SHORT_SIDE = 600;
export const DUPLICATE_DISTANCE = 6;

export interface SearchInput {
  name: string;
  category: string;
  color?: string | null;
  query?: string | null;          // optional manual override from the admin
  providers?: Provider[];
}

export interface ExistingImage { product_id: string; provider: string; provider_image_id: string; phash: string | null }

export interface SearchDeps {
  fetch: typeof fetch;
  keys: Keys;
  existingImages: () => Promise<ExistingImage[]>;
  productId?: string;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  reasons: string[];
  subjectHex: string;
  hash: string;
  colorDistance: number | null;
}

export interface Rejected { provider: Provider; id: string; reason: string }

export function buildQuery(input: SearchInput): { query: string; cat: Category; colorName?: string; typeWord: string } {
  const cat = CATEGORIES[input.category];
  if (!cat) throw new Error(`Unknown category: ${input.category}`);
  const name = input.name.toLowerCase();
  const colorName = (input.color?.trim().toLowerCase() || findColorName(name)) ?? undefined;
  const typeWord = cat.terms.filter((t) => anyWord(name, [t]).length).sort((a, b) => b.length - a.length)[0] ?? cat.query;
  const query = input.query?.trim() || [colorName, typeWord].filter(Boolean).join(" ");
  return { query, cat, colorName, typeWord };
}

// Text checks that need no download. Returns a reject reason or text points and notes.
export function textCheck(c: Candidate, cat: Category): { reject?: string; points: number; notes: string[] } {
  const notes: string[] = [];
  const blocked = anyWord(c.text, BLOCK_WORDS);
  if (blocked.length) return { reject: `Branded, watermarked or text image (${blocked[0]})`, points: 0, notes };
  if (Math.min(c.width, c.height) < MIN_SHORT_SIDE) return { reject: "Resolution too low", points: 0, notes };
  const own = anyWord(c.text, cat.terms);
  const conflict = anyWord(c.text, conflictTerms(cat));
  if (!own.length && conflict.length) return { reject: `Shows ${conflict[0]}, not ${cat.label.toLowerCase()}`, points: 0, notes };
  let points = 0;
  if (own.length) { points += 35; notes.push(`Matches "${own[0]}"`); }
  else if (c.text.trim()) notes.push("Item type not confirmed by description");
  if (own.length && conflict.length) { points -= 10; notes.push(`Also shows ${conflict[0]}`); }
  const prod = anyWord(c.text, PRODUCT_WORDS), people = anyWord(c.text, PEOPLE_WORDS);
  if (prod.length) { points += 8; notes.push("Product style photo"); }
  if (people.length) { points -= prod.length ? 15 : 30; notes.push("Person in photo"); }
  return { points, notes };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function runSearch(input: SearchInput, deps: SearchDeps) {
  const { query, cat, colorName } = buildQuery(input);
  const target: RGB | undefined = colorRGB(colorName);
  const providers = (input.providers?.length ? input.providers : PROVIDERS).filter((p) => PROVIDERS.includes(p));

  const status: Record<string, { ok: boolean; count: number; message?: string }> = {};
  const settled = await Promise.allSettled(providers.map((p) => searchProvider(deps.fetch, deps.keys, p, query, colorName)));
  const raw: Candidate[] = [];
  settled.forEach((r, i) => {
    const p = providers[i];
    if (r.status === "fulfilled") { status[p] = { ok: true, count: r.value.length }; raw.push(...r.value); }
    else status[p] = { ok: false, count: 0, message: r.reason instanceof ProviderError ? r.reason.message : `${p} failed.` };
  });

  const rejected: Rejected[] = [];
  const existing = await deps.existingImages();
  const seen = new Set<string>();
  const firstPass: { c: Candidate; points: number; notes: string[] }[] = [];
  for (const c of raw) {
    const key = `${c.provider}:${c.id}`;
    if (seen.has(key) || !c.previewUrl || !c.sourceUrl) continue;
    seen.add(key);
    if (deps.productId && existing.some((e) => e.product_id === deps.productId && e.provider === c.provider && e.provider_image_id === c.id)) {
      rejected.push({ provider: c.provider, id: c.id, reason: "Already added to this product" }); continue;
    }
    const t = textCheck(c, cat);
    if (t.reject) { rejected.push({ provider: c.provider, id: c.id, reason: t.reject }); continue; }
    firstPass.push({ c, points: t.points, notes: t.notes });
  }

  // Download each preview: drops broken images and measures color, background and fingerprint.
  const analysed = await pool(firstPass, 6, async (f) => {
    try {
      const img = await decodeImage(await fetchImageBytes(deps.fetch, f.c.previewUrl, 10000));
      return { ...f, a: analyze(img) };
    } catch (e) {
      rejected.push({ provider: f.c.provider, id: f.c.id, reason: `Broken image: ${(e as Error).message}` });
      return null;
    }
  });

  const scored: ScoredCandidate[] = [];
  for (const r of analysed) {
    if (!r) continue;
    const { c, a } = r;
    let score = r.points;
    const reasons = [...r.notes];
    let dist: number | null = null;
    if (target) {
      dist = deltaE(a.subjectColor, target);
      const providerDist = c.providerColor ? deltaE(hexToRgb(c.providerColor), target) : Infinity;
      const best = Math.min(dist, providerDist + 8);
      score += Math.round(30 * Math.max(0, 1 - best / 50));
      reasons.push(best < 18 ? `Color matches ${colorName}` : best < 35 ? `Color close to ${colorName}` : `Color differs from ${colorName}`);
    } else score += 15;
    if (a.backgroundPlain) { score += 12; reasons.push("Plain background"); }
    if (a.backgroundLight) score += 4;
    if (Math.min(c.width, c.height) >= 1200) score += 4;
    scored.push({ ...c, score: Math.max(0, Math.min(100, score)), reasons, subjectHex: a.subjectHex, hash: a.hash, colorDistance: dist });
  }

  // Duplicates: the same photo from two providers, or a photo already used anywhere in the store.
  scored.sort((x, y) => y.score - x.score);
  const kept: ScoredCandidate[] = [];
  for (const s of scored) {
    const dupStore = existing.find((e) => e.phash && hamming(e.phash, s.hash) <= DUPLICATE_DISTANCE);
    if (dupStore) { rejected.push({ provider: s.provider, id: s.id, reason: `Duplicate of an image already used on product ${dupStore.product_id}` }); continue; }
    if (kept.some((k) => hamming(k.hash, s.hash) <= DUPLICATE_DISTANCE)) { rejected.push({ provider: s.provider, id: s.id, reason: "Duplicate of another result" }); continue; }
    if (s.score < MIN_SCORE) { rejected.push({ provider: s.provider, id: s.id, reason: `Not a close enough match (score ${s.score})` }); continue; }
    kept.push(s);
  }

  return { query, category: cat.key, color: colorName ?? null, providers: status, results: kept.slice(0, 24), rejected };
}

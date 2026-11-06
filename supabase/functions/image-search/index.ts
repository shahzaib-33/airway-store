// POST { name, category, color?, query?, providers?, productId? }
// Returns checked, scored and de-duplicated image candidates from Pexels, Unsplash and Pixabay.
import { handleError, json, keysFromEnv, requireAdmin, serviceClient } from "../_shared/http.ts";
import { runSearch } from "../_shared/search.ts";

const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 10 * 60 * 1000; // saves provider quota when the same search repeats

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  try {
    await requireAdmin(req);
    const body = await req.json();
    if (!body?.name || !body?.category) return json(req, { error: "Product name and category are required." }, 400);
    const db = serviceClient();
    const key = JSON.stringify([body.name, body.category, body.color, body.query, body.providers, body.productId]);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && !body.refresh) return json(req, hit.body);
    const result = await runSearch(body, {
      fetch, keys: keysFromEnv(), productId: body.productId,
      existingImages: async () => {
        const { data, error } = await db.from("product_images").select("product_id,provider,provider_image_id,phash");
        if (error) throw error;
        return data ?? [];
      },
    });
    const out = { ...result, attribution: "Photos provided by Pexels, Unsplash and Pixabay" };
    cache.set(key, { at: Date.now(), body: out });
    return json(req, out);
  } catch (e) {
    return handleError(req, e);
  }
});

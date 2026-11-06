// POST { productId, provider, providerImageId, makePrimary? }
// Imports the chosen image: Pexels and Pixabay are downloaded, optimized and stored in the
// product-images bucket. Unsplash is hotlinked as its API rules require. A row is saved in product_images.
import { handleError, json, keysFromEnv, requireAdmin, serviceClient, supabaseStore } from "../_shared/http.ts";
import { importImage } from "../_shared/importer.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  try {
    await requireAdmin(req);
    const b = await req.json();
    if (!b?.productId || !b?.provider || !b?.providerImageId) return json(req, { error: "productId, provider and providerImageId are required." }, 400);
    const image = await importImage(
      { productId: String(b.productId), provider: b.provider, providerImageId: String(b.providerImageId), makePrimary: b.makePrimary },
      { fetch, keys: keysFromEnv(), store: supabaseStore(serviceClient()) },
    );
    return json(req, { image }, 201);
  } catch (e) {
    return handleError(req, e);
  }
});

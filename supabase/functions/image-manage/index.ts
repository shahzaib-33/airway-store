// POST { action: "delete" | "set_primary" | "replace", imageId, provider?, providerImageId? }
// Admin actions on product images. Deleting also removes self hosted files from storage.
import { handleError, json, keysFromEnv, requireAdmin, serviceClient, supabaseStore } from "../_shared/http.ts";
import { deleteImage, replaceImage, setPrimary } from "../_shared/importer.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, "ok");
  try {
    await requireAdmin(req);
    const b = await req.json();
    const store = supabaseStore(serviceClient());
    if (!b?.imageId) return json(req, { error: "imageId is required." }, 400);
    if (b.action === "delete") { await deleteImage(String(b.imageId), store); return json(req, { ok: true }); }
    if (b.action === "set_primary") { await setPrimary(String(b.imageId), store); return json(req, { ok: true }); }
    if (b.action === "replace") {
      if (!b.provider || !b.providerImageId) return json(req, { error: "provider and providerImageId are required." }, 400);
      const image = await replaceImage(String(b.imageId), b.provider, String(b.providerImageId), { fetch, keys: keysFromEnv(), store });
      return json(req, { image });
    }
    return json(req, { error: "Unknown action." }, 400);
  } catch (e) {
    return handleError(req, e);
  }
});

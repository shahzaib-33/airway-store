// Shared plumbing for the edge functions: CORS, admin check, errors, and the Supabase backed Store.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ImageError } from "./imaging.ts";
import { ImageRow, ImportError, ProductRow, Store } from "./importer.ts";
import { Keys, ProviderError } from "./providers.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

export function keysFromEnv(): Keys {
  return {
    pexels: Deno.env.get("PEXELS_API_KEY") || undefined,
    unsplash: Deno.env.get("UNSPLASH_ACCESS_KEY") || undefined,
    pixabay: Deno.env.get("PIXABAY_API_KEY") || undefined,
    unsplashAppName: Deno.env.get("UNSPLASH_APP_NAME") || "airway_store",
  };
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

// Only signed in users listed in public.admins may use these functions.
export async function requireAdmin(req: Request): Promise<void> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new ImportError(401, "Please sign in.");
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: ue } = await user.auth.getUser(auth.slice(7));
  if (ue || !u?.user) throw new ImportError(401, "Your session has expired. Please sign in again.");
  const { data, error } = await user.rpc("is_admin");
  if (error || data !== true) throw new ImportError(403, "This account is not an admin.");
}

export function handleError(req: Request, e: unknown): Response {
  if (e instanceof ImportError) return json(req, { error: e.message }, e.status);
  if (e instanceof ImageError) return json(req, { error: e.message, code: e.code }, 422);
  if (e instanceof ProviderError) return json(req, { error: e.message, provider: e.provider }, e.status === 429 ? 429 : 502);
  console.error(e);
  return json(req, { error: "Something went wrong. Please try again." }, 500);
}

export const BUCKET = "product-images";

export function supabaseStore(db: SupabaseClient): Store {
  const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async getProduct(id) {
      return must(await db.from("products").select("id,name,category").eq("id", id).maybeSingle()) as ProductRow | null;
    },
    async listImages(productId) {
      let q = db.from("product_images").select("*");
      if (productId) q = q.eq("product_id", productId);
      return must(await q) as ImageRow[];
    },
    async getImage(id) {
      return must(await db.from("product_images").select("*").eq("id", id).maybeSingle()) as ImageRow | null;
    },
    async insertImage(row) {
      return must(await db.from("product_images").insert(row).select("*").single()) as ImageRow;
    },
    async updateImage(id, patch) { must(await db.from("product_images").update(patch).eq("id", id)); },
    async deleteImage(id) { must(await db.from("product_images").delete().eq("id", id)); },
    async upload(path, bytes, contentType) {
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`Upload failed: ${error.message}`);
      return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async remove(paths) { if (paths.length) await db.storage.from(BUCKET).remove(paths); },
  };
}

// Airway data layer shared by the store and the admin panel.
// Talks to Supabase (database, auth, storage and the image edge functions).
(function () {
  const cfg = window.AIRWAY_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

  // Tests and previews may provide their own implementation.
  if (window.AIRWAY_API_OVERRIDE) { window.AirwayAPI = window.AIRWAY_API_OVERRIDE; return; }

  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const need = () => { if (!sb) throw new Error("Supabase is not configured. Add your project URL and anon key to js/config.js."); };
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  async function callFn(name, body) {
    need();
    const { data: s } = await sb.auth.getSession();
    const token = s?.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey },
      body: JSON.stringify(body),
    });
    let out = {};
    try { out = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  }

  window.AirwayAPI = {
    configured,

    // ---------- auth ----------
    async session() { if (!sb) return null; return (await sb.auth.getSession()).data.session; },
    async signIn(email, password) { need(); return check(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { if (sb) await sb.auth.signOut(); },
    async isAdmin() { need(); return check(await sb.rpc("is_admin")) === true; },
    onAuth(cb) { if (sb) sb.auth.onAuthStateChange((_e, s) => cb(s)); },

    // ---------- catalog (public) ----------
    async catalog() { need(); return check(await sb.from("product_catalog").select("*").order("created_at")); },

    // ---------- admin data ----------
    async categories() { need(); return check(await sb.from("categories").select("*").order("sort")); },
    async products() {
      need();
      return check(await sb.from("products").select("*, product_images(id, thumb_url, is_primary)").order("created_at", { ascending: false }));
    },
    async saveProduct(p) {
      need();
      const row = { name: p.name, category: p.category, color: p.color || null, price: Number(p.price) || 0,
        description: p.description || null, sizes: p.sizes?.length ? p.sizes : null, is_active: p.is_active !== false };
      if (p.id) return check(await sb.from("products").update(row).eq("id", p.id).select("*").single());
      return check(await sb.from("products").insert(row).select("*").single());
    },
    async deleteProduct(id) {
      need();
      // remove stored files first through the manage function, then the product row (images cascade)
      const imgs = check(await sb.from("product_images").select("id").eq("product_id", id));
      for (const i of imgs) await callFn("image-manage", { action: "delete", imageId: i.id });
      check(await sb.from("products").delete().eq("id", id));
    },
    async images(productId) {
      need();
      return check(await sb.from("product_images").select("*").eq("product_id", productId).order("is_primary", { ascending: false }).order("created_at"));
    },

    // ---------- image system ----------
    searchImages: (params) => callFn("image-search", params),
    importImage: (params) => callFn("image-import", params),
    deleteImage: (imageId) => callFn("image-manage", { action: "delete", imageId }),
    setPrimary: (imageId) => callFn("image-manage", { action: "set_primary", imageId }),
    replaceImage: (imageId, provider, providerImageId) => callFn("image-manage", { action: "replace", imageId, provider, providerImageId }),
  };
})();

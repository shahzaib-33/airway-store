// In-browser stand-in for the Supabase backend, used by the UI tests only.
// It behaves like the real API: same method names, same response shapes.
(function () {
  const FIX = window.__FIXTURE_BASE__;
  const SECTION = { mens_shirts: "shirts", tshirts: "shirts", hoodies: "shirts", jeans_trousers: "trousers", jackets: "clothes",
    womens_dresses: "dress", shoes: "shoes", accessories: "accessories", shalwar_kameez: "dress", mens_suits: "dress", outfit_sets: "dress" };
  const CATS = Object.keys(SECTION).map((key, i) => ({ key, label: { mens_shirts: "Men's shirts", tshirts: "T-shirts", hoodies: "Hoodies",
    jeans_trousers: "Jeans and trousers", jackets: "Jackets", womens_dresses: "Women's dresses", shoes: "Shoes", accessories: "Accessories",
    shalwar_kameez: "Shalwar kameez", mens_suits: "Men's suits", outfit_sets: "Outfit sets" }[key], store_section: SECTION[key], sort: i }));
  const db = { products: JSON.parse(JSON.stringify(window.__PRODUCTS__ || [])), images: window.__IMAGES__ || [] };
  db.products.forEach((p, i) => (p.created_at = new Date(2026, 0, 1, 0, i).toISOString()));
  let n = 0, session = window.__SIGNED_IN__ ? { user: { email: "owner@airway.pk" }, access_token: "t" } : null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const RESULTS = [
    { provider: "pexels", id: "101", previewUrl: FIX + "belt1.jpg", score: 91, subjectHex: "#1c1816", reasons: ['Matches "belt"', "Color matches black", "Plain background"], photographer: "Ana P", photographerUrl: "https://www.pexels.com/@ana", pageUrl: "https://www.pexels.com/photo/101/", text: "black leather belt isolated", width: 3000, height: 4000 },
    { provider: "pixabay", id: "202", previewUrl: FIX + "belt2.jpg", score: 78, subjectHex: "#281e1a", reasons: ['Matches "belt"', "Color matches black"], photographer: "pixuser", photographerUrl: "https://pixabay.com/users/pixuser-1/", pageUrl: "https://pixabay.com/photos/202/", text: "belt, leather", width: 4000, height: 5000 },
    { provider: "unsplash", id: "u303", previewUrl: FIX + "belt3.jpg", score: 64, subjectHex: "#3c281e", reasons: ['Matches "belt"', "Color close to black", "Plain background"], photographer: "Uma S", photographerUrl: "https://unsplash.com/@uma?utm_source=airway_store&utm_medium=referral", pageUrl: "https://unsplash.com/photos/u303?utm_source=airway_store&utm_medium=referral", text: "brown belt flat lay", width: 3000, height: 4000 },
  ];
  const att = (c) => c.provider === "pexels" ? `Photo by ${c.photographer} on Pexels` : c.provider === "unsplash" ? `Photo by ${c.photographer} on Unsplash` : `Image by ${c.photographer} from Pixabay`;
  const mkImage = (productId, c, primary) => {
    const p = db.products.find((x) => x.id === productId);
    return { id: "img" + ++n, product_id: productId, product_name: p.name, category: p.category, provider: c.provider, provider_image_id: c.id,
      hosting: c.provider === "unsplash" ? "hotlink" : "self", image_url: c.previewUrl, thumb_url: c.previewUrl, source_page_url: c.pageUrl,
      photographer: c.photographer, photographer_url: c.photographerUrl, license: "x", attribution: att(c), width: c.width, height: c.height,
      is_primary: primary, created_at: new Date(Date.now() + n * 1000).toISOString() };
  };
  window.__CALLS__ = [];
  window.AIRWAY_API_OVERRIDE = {
    configured: true,
    async session() { return session; },
    async signIn(email, password) { await wait(150); if (password !== "secret123") throw new Error("Invalid login credentials"); session = { user: { email }, access_token: "t" }; return { session }; },
    async signOut() { session = null; },
    async isAdmin() { return session?.user.email === "owner@airway.pk"; },
    onAuth() {},
    async catalog() {
      return db.products.filter((p) => p.is_active).map((p) => {
        const i = db.images.find((x) => x.product_id === p.id && x.is_primary);
        const c = CATS.find((x) => x.key === p.category);
        return { ...p, category_label: c.label, store_section: c.store_section, image_url: i?.image_url ?? null, thumb_url: i?.thumb_url ?? null,
          attribution: i?.attribution ?? null, photographer_url: i?.photographer_url ?? null, source_page_url: i?.source_page_url ?? null, provider: i?.provider ?? null };
      });
    },
    async categories() { return CATS; },
    async products() {
      return [...db.products].reverse().map((p) => ({ ...p, product_images: db.images.filter((i) => i.product_id === p.id) }));
    },
    async saveProduct(p) {
      await wait(100);
      if (p.id) { const x = db.products.find((y) => y.id === p.id); Object.assign(x, p); return x; }
      const row = { ...p, id: "p_" + Math.random().toString(36).slice(2, 8), attributes: {}, created_at: new Date().toISOString() };
      db.products.push(row); return row;
    },
    async deleteProduct(id) { db.products = db.products.filter((p) => p.id !== id); db.images = db.images.filter((i) => i.product_id !== id); },
    async images(pid) { return db.images.filter((i) => i.product_id === pid).sort((a, b) => b.is_primary - a.is_primary); },
    async searchImages(params) {
      window.__CALLS__.push(["search", params]); await wait(300);
      const used = db.images.filter((i) => i.product_id === params.productId).map((i) => i.provider_image_id);
      return { query: "black belt", category: params.category, color: params.color || null,
        providers: { pexels: { ok: true, count: 20 }, unsplash: { ok: true, count: 20 }, pixabay: { ok: false, count: 0, message: "Pixabay API key is not set." } },
        results: RESULTS.filter((r) => !used.includes(r.id)),
        rejected: [{ provider: "pexels", id: "9", reason: "Person in photo" }, { provider: "unsplash", id: "z", reason: "Branded, watermarked or text image (logo)" }, { provider: "pexels", id: "8", reason: "Broken image: Image request failed with status 404" }] };
    },
    async importImage({ productId, provider, providerImageId }) {
      window.__CALLS__.push(["import", provider, providerImageId]); await wait(200);
      const c = RESULTS.find((r) => r.provider === provider && r.id === providerImageId);
      const primary = !db.images.some((i) => i.product_id === productId);
      const img = mkImage(productId, c, primary); db.images.push(img); return { image: img };
    },
    async setPrimary(id) { const img = db.images.find((i) => i.id === id); db.images.forEach((i) => { if (i.product_id === img.product_id) i.is_primary = i.id === id; }); return { ok: true }; },
    async deleteImage(id) {
      const img = db.images.find((i) => i.id === id); db.images = db.images.filter((i) => i.id !== id);
      if (img.is_primary) { const rest = db.images.filter((i) => i.product_id === img.product_id); if (rest[0]) rest[0].is_primary = true; }
      return { ok: true };
    },
    async replaceImage(id, provider, pid) {
      const old = db.images.find((i) => i.id === id);
      const c = RESULTS.find((r) => r.provider === provider && r.id === pid);
      const img = mkImage(old.product_id, c, false);
      db.images = db.images.filter((i) => i.id !== id); if (old.is_primary) img.is_primary = true; db.images.push(img);
      window.__CALLS__.push(["replace", id, pid]); return { image: img };
    },
  };
})();

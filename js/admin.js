// Airway admin panel: products, automatic image search, import, replace and delete.
(function () {
  const api = window.AirwayAPI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => "Rs " + Number(n || 0).toLocaleString("en-US");
  const COLORS = ["white", "off white", "ivory", "cream", "beige", "stone", "khaki", "camel", "tan", "brown", "black", "charcoal", "grey",
    "light grey", "navy", "blue", "light blue", "denim", "red", "maroon", "burgundy", "pink", "green", "dark green", "olive", "sage green",
    "yellow", "mustard", "orange", "purple", "lilac", "teal", "gold", "silver"];

  const state = { categories: [], products: [], current: null, images: [], replacing: null, lastSearch: null };

  // ---------- small UI helpers ----------
  let tt;
  function toast(msg, bad) {
    const t = $("toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(tt); tt = setTimeout(() => (t.className = "toast" + (bad ? " bad" : "")), 3200);
  }
  function confirmBox(title, text, yes = "Confirm") {
    return new Promise((resolve) => {
      $("dlgT").textContent = title; $("dlgP").textContent = text; $("dlgYes").textContent = yes;
      $("dlg").classList.add("show");
      const done = (v) => { $("dlg").classList.remove("show"); $("dlgYes").onclick = $("dlgNo").onclick = null; resolve(v); };
      $("dlgYes").onclick = () => done(true); $("dlgNo").onclick = () => done(false);
    });
  }
  async function busy(btn, fn) {
    const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(btn.textContent.trim())}`;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
  }
  const catLabel = (k) => state.categories.find((c) => c.key === k)?.label ?? k;
  const scoreClass = (s) => (s >= 70 ? "s-hi" : s >= 55 ? "s-mid" : "s-lo");
  const provName = (p) => ({ pexels: "Pexels", unsplash: "Unsplash", pixabay: "Pixabay" }[p] || p);

  // ---------- views ----------
  function show(view) {
    $("loginView").hidden = view !== "login";
    $("appView").hidden = view !== "app";
    $("who").hidden = view !== "app";
  }

  async function boot() {
    $("colorList").innerHTML = COLORS.map((c) => `<option value="${c}">`).join("");
    if (!api.configured) {
      $("configNotice").innerHTML = `<div class="notice" style="margin-bottom:16px">This admin is not connected yet. Add your Supabase project URL and anon key to <code>js/config.js</code>, then reload. The README explains each step.</div>`;
      $("loginBtn").disabled = true;
      return show("login");
    }
    const s = await api.session();
    if (s) await enter(s); else show("login");
    api.onAuth((sess) => { if (!sess) show("login"); });
  }

  async function enter(session) {
    let admin = false;
    try { admin = await api.isAdmin(); } catch (e) { $("loginErr").textContent = e.message; }
    if (!admin) {
      await api.signOut(); show("login");
      $("loginErr").textContent = "This account is not an admin. Add its email to the admins table.";
      return;
    }
    $("whoEmail").textContent = session.user?.email ?? "";
    show("app");
    state.categories = await api.categories();
    $("fCat").innerHTML = state.categories.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join("");
    $("catFilter").innerHTML = `<option value="">All categories</option>` + state.categories.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join("");
    await loadProducts();
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginErr").textContent = "";
    await busy($("loginBtn"), async () => {
      try { const d = await api.signIn($("email").value.trim(), $("password").value); await enter(d.session); }
      catch (err) { $("loginErr").textContent = err.message.includes("Invalid") ? "Wrong email or password." : err.message; }
    });
  });
  $("signOut").onclick = async () => { await api.signOut(); location.reload(); };

  // ---------- product list ----------
  async function loadProducts() {
    state.products = await api.products();
    renderList();
  }
  function renderList() {
    const q = $("q").value.trim().toLowerCase(), cat = $("catFilter").value;
    const list = state.products.filter((p) => (!cat || p.category === cat) && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
    $("countLbl").textContent = `${list.length} product${list.length === 1 ? "" : "s"}`;
    $("plist").innerHTML = list.map((p) => {
      const imgs = p.product_images || [], pri = imgs.find((i) => i.is_primary) || imgs[0];
      return `<button class="pi ${state.current?.id === p.id ? "on" : ""}" data-id="${esc(p.id)}" role="listitem">
        <span class="pthumb">${pri ? `<img src="${esc(pri.thumb_url)}" alt="" loading="lazy">` : esc(p.name[0])}</span>
        <span class="nm"><b>${esc(p.name)}</b><small class="muted">${esc(catLabel(p.category))} · ${fmt(p.price)}</small></span>
        <span class="badge ${imgs.length ? "" : "none"}">${imgs.length ? `${imgs.length} img` : "No image"}</span></button>`;
    }).join("") || `<p class="muted" style="padding:20px 8px">No products match.</p>`;
  }
  $("q").oninput = renderList;
  $("catFilter").onchange = renderList;
  $("plist").onclick = (e) => { const b = e.target.closest(".pi"); if (b) openProduct(b.dataset.id); };
  $("newBtn").onclick = () => openProduct(null);
  $("backList").onclick = () => { $("appView").classList.remove("editing"); state.current = null; renderList(); };

  // ---------- editor ----------
  async function openProduct(id) {
    const p = id ? state.products.find((x) => x.id === id) : null;
    state.current = p; state.replacing = null;
    $("emptyState").hidden = true; $("editor").hidden = false;
    $("appView").classList.add("editing");
    $("editTitle").textContent = p ? p.name : "New product";
    $("pidLbl").textContent = p ? `Product ID ${p.id}` : "Not saved yet";
    $("delProduct").hidden = !p;
    $("fName").value = p?.name ?? ""; $("fCat").value = p?.category ?? state.categories[0]?.key;
    $("fColor").value = p?.color ?? ""; $("fPrice").value = p?.price ?? 0;
    $("fSizes").value = (p?.sizes ?? []).join(", "); $("fDesc").value = p?.description ?? "";
    $("fActive").checked = p ? p.is_active : true;
    $("imagesSec").hidden = !p; $("finderSec").hidden = !p;
    $("results").innerHTML = ""; $("status").innerHTML = ""; $("rejected").hidden = true; $("fq").value = "";
    renderReplaceBar();
    renderList();
    if (p) { await loadImages(); if (!state.images.length) runSearch(); }
    else $("fName").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("pform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const isNew = !state.current;
    const before = state.current;
    const data = {
      id: state.current?.id, name: $("fName").value.trim(), category: $("fCat").value, color: $("fColor").value.trim().toLowerCase(),
      price: $("fPrice").value, description: $("fDesc").value.trim(),
      sizes: $("fSizes").value.split(",").map((s) => s.trim()).filter(Boolean), is_active: $("fActive").checked,
    };
    if (data.name.length < 2) return toast("Please enter a product name.", true);
    await busy($("saveBtn"), async () => {
      try {
        const saved = await api.saveProduct(data);
        await loadProducts();
        toast(isNew ? "Product added. Searching for images." : "Product saved.");
        await openProduct(saved.id);
        // When name, category or color change, search again for fresh matches.
        if (!isNew && before && (before.name !== saved.name || before.category !== saved.category || before.color !== saved.color)) runSearch();
      } catch (err) { toast(err.message, true); }
    });
  });

  $("delProduct").onclick = async () => {
    const p = state.current; if (!p) return;
    if (!(await confirmBox("Delete product?", `"${p.name}" and all its images will be removed from the store. This cannot be undone.`, "Delete"))) return;
    try { await api.deleteProduct(p.id); toast("Product deleted."); state.current = null; $("editor").hidden = true; $("emptyState").hidden = false; $("appView").classList.remove("editing"); await loadProducts(); }
    catch (err) { toast(err.message, true); }
  };

  // ---------- current images ----------
  async function loadImages() {
    state.images = await api.images(state.current.id);
    $("imgCount").textContent = state.images.length ? `${state.images.length} image${state.images.length === 1 ? "" : "s"}` : "";
    $("imgGrid").innerHTML = state.images.length ? state.images.map((i, k) => `
      <div class="ic" style="animation-delay:${k * 40}ms" data-id="${i.id}">
        <div class="ph"><img src="${esc(i.thumb_url)}" alt="${esc(i.product_name)}" loading="lazy" onerror="this.closest('.ic').classList.add('broken')">
          <div class="tag">${i.is_primary ? `<span class="pri">MAIN</span>` : ""}<span>${provName(i.provider)}</span></div></div>
        <div class="body">
          <div class="credit"><a href="${esc(i.photographer_url || i.source_page_url)}" target="_blank" rel="noopener">${esc(i.attribution)}</a></div>
          <div class="why">${i.hosting === "self" ? "Stored in your storage" : "Linked from Unsplash (required)"} · ${i.width}×${i.height}</div>
          <div class="row">
            ${i.is_primary ? "" : `<button class="btn ghost sm" data-act="primary">Make main</button>`}
            <button class="btn ghost sm" data-act="replace">Replace</button>
            <button class="btn danger sm" data-act="delete">Delete</button>
          </div>
        </div></div>`).join("")
      : `<p class="muted">No images yet. Pick one from the results below.</p>`;
  }

  $("imgGrid").onclick = async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest(".ic").dataset.id, img = state.images.find((i) => i.id === id);
    if (b.dataset.act === "primary") {
      await busy(b, async () => { try { await api.setPrimary(id); toast("Main image updated."); await refreshAfterChange(); } catch (err) { toast(err.message, true); } });
    } else if (b.dataset.act === "delete") {
      if (!(await confirmBox("Delete image?", "The image is removed from this product" + (img.hosting === "self" ? " and from your storage." : "."), "Delete"))) return;
      await busy(b, async () => { try { await api.deleteImage(id); toast("Image deleted."); await refreshAfterChange(); } catch (err) { toast(err.message, true); } });
    } else if (b.dataset.act === "replace") {
      state.replacing = img; renderReplaceBar(); renderResults();
      $("finderSec").scrollIntoView({ behavior: "smooth", block: "start" });
      if (!state.lastSearch) runSearch();
    }
  };

  function renderReplaceBar() {
    $("replaceBar").innerHTML = state.replacing
      ? `<div class="replacing"><span>Choose a photo to replace the ${state.replacing.is_primary ? "main" : "selected"} image (${provName(state.replacing.provider)}).</span><button class="btn ghost sm" id="cancelReplace">Cancel</button></div>` : "";
    const c = $("cancelReplace"); if (c) c.onclick = () => { state.replacing = null; renderReplaceBar(); renderResults(); };
  }

  async function refreshAfterChange() {
    await loadImages(); await loadProducts();
    if (state.lastSearch) renderResults();
  }

  // ---------- search ----------
  const selectedProviders = () => [...$("provs").querySelectorAll("input:checked")].map((i) => i.value);
  $("provs").onchange = () => $("provs").querySelectorAll(".prov").forEach((l) => l.classList.toggle("off", !l.querySelector("input").checked));
  $("searchBtn").onclick = () => runSearch(true);
  $("fq").onkeydown = (e) => { if (e.key === "Enter") runSearch(true); };

  async function runSearch(refresh) {
    const p = state.current; if (!p) return;
    const providers = selectedProviders();
    if (!providers.length) return toast("Pick at least one image source.", true);
    $("results").innerHTML = Array.from({ length: 8 }, () => `<div class="skel"></div>`).join("");
    $("status").innerHTML = `<span class="st">Searching ${providers.map(provName).join(", ")}…</span>`;
    $("rejected").hidden = true;
    await busy($("searchBtn"), async () => {
      try {
        const r = await api.searchImages({ productId: p.id, name: p.name, category: p.category, color: p.color, query: $("fq").value.trim() || null, providers, refresh: !!refresh });
        state.lastSearch = r;
        if (!$("fq").value.trim()) $("fq").placeholder = `automatic: ${r.query}`;
        $("status").innerHTML = Object.entries(r.providers).map(([k, v]) =>
          `<span class="st ${v.ok ? "" : "bad"}">${provName(k)}: ${v.ok ? `${v.count} found` : esc(v.message)}</span>`).join("") +
          `<span class="st">${r.results.length} good match${r.results.length === 1 ? "" : "es"}</span>`;
        renderResults();
      } catch (err) {
        $("results").innerHTML = ""; $("status").innerHTML = `<span class="st bad">${esc(err.message)}</span>`;
      }
    });
  }

  function renderResults() {
    const r = state.lastSearch; if (!r) return;
    const target = r.color;
    $("results").innerHTML = r.results.length ? r.results.map((c, k) => `
      <div class="ic" style="animation-delay:${k * 35}ms" data-k="${k}">
        <div class="ph"><img class="loading" src="${esc(c.previewUrl)}" alt="${esc(c.text.slice(0, 80))}" loading="lazy" referrerpolicy="no-referrer"
            onload="this.classList.remove('loading')" onerror="this.closest('.ic').remove()">
          <div class="tag"><span>${provName(c.provider)}</span></div>
          <span class="score ${scoreClass(c.score)}" title="Match score">${c.score}</span></div>
        <div class="body">
          ${target ? `<span class="sw"><i style="background:${esc(c.subjectHex)}"></i>item color vs ${esc(target)}</span>` : ""}
          <div class="why">${c.reasons.map(esc).join(" · ")}</div>
          <div class="credit">Photo by <a href="${esc(c.photographerUrl)}" target="_blank" rel="noopener">${esc(c.photographer)}</a> on <a href="${esc(c.pageUrl)}" target="_blank" rel="noopener">${provName(c.provider)}</a></div>
          <div class="row"><button class="btn sm" data-import="${k}">${state.replacing ? "Use as replacement" : "Import"}</button></div>
        </div></div>`).join("")
      : `<p class="muted">No close matches. Try simpler search words, for example the color and item type only.</p>`;
    const rej = r.rejected || [];
    $("rejected").hidden = !rej.length;
    if (rej.length) {
      $("rejected").querySelector("summary").textContent = `${rej.length} photo${rej.length === 1 ? " was" : "s were"} filtered out (broken, duplicate, branded, low quality or unrelated)`;
      $("rejected").querySelector("ul").innerHTML = rej.slice(0, 60).map((x) => `<li>${provName(x.provider)} ${esc(x.id)}: ${esc(x.reason)}</li>`).join("");
    }
  }

  $("results").onclick = async (e) => {
    const b = e.target.closest("[data-import]"); if (!b) return;
    const c = state.lastSearch.results[+b.dataset.import];
    await busy(b, async () => {
      try {
        if (state.replacing) {
          await api.replaceImage(state.replacing.id, c.provider, c.id);
          toast("Image replaced."); state.replacing = null; renderReplaceBar();
        } else {
          const { image } = await api.importImage({ productId: state.current.id, provider: c.provider, providerImageId: c.id });
          toast(image.is_primary ? "Imported as the main image." : "Image imported.");
        }
        state.lastSearch.results = state.lastSearch.results.filter((x) => x !== c);
        await refreshAfterChange();
      } catch (err) { toast(err.message, true); }
    });
  };

  boot().catch((e) => { console.error(e); toast(e.message, true); });
})();

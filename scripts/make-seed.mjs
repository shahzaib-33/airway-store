// Generates supabase/seed.sql from the product list built into index.html,
// so the database starts with exactly the products the store already sells.
import fs from "node:fs";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("const products = [");
const end = html.indexOf("];", start) + 2;
const products = eval(html.slice(start, end).replace("const products =", "("). replace(/];$/, "])"));
const CAT = {s1:"mens_shirts",s2:"mens_shirts",s3:"tshirts",s4:"tshirts",s5:"hoodies",t1:"jeans_trousers",t2:"jeans_trousers",t3:"jeans_trousers",t4:"jeans_trousers",t5:"jeans_trousers",
  c1:"jackets",c2:"jackets",c3:"jackets",c4:"womens_dresses",c5:"jackets",f1:"shoes",f2:"shoes",f3:"shoes",f4:"shoes",f5:"shoes",
  d1:"outfit_sets",d2:"outfit_sets",d3:"shalwar_kameez",d4:"shalwar_kameez",d5:"shalwar_kameez",d6:"shalwar_kameez",d7:"womens_dresses",d8:"womens_dresses",d9:"womens_dresses",d10:"mens_suits",d11:"mens_suits"};
const COLOR = {s1:"white",s2:"light blue",s3:"black",s4:"olive",s5:"grey",t1:"beige",t2:"blue",t3:"khaki",t4:"black",t5:"brown",c1:"camel",c2:"red",c3:"cream",c4:"burgundy",c5:"light blue",
  f1:"white",f2:"black",f3:"brown",f4:"grey",f5:"beige",d1:"white",d2:"black",d3:"white",d4:"charcoal",d5:"pink",d6:"green",d7:"maroon",d8:"black",d9:"sage green",d10:"navy",d11:"charcoal"};
const q = v => v == null ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const rows = products.map(p => {
  const { id, name, price, desc, cat, sizes, ...rest } = p;
  const attributes = { ...rest, section: cat };
  const sz = sizes ? "array[" + sizes.map(q).join(",") + "]" : "null";
  return `  (${q(id)}, ${q(name)}, ${q(CAT[id])}, ${q(COLOR[id])}, ${price}, ${q(desc)}, ${sz}, ${q(JSON.stringify(attributes))}::jsonb)`;
});
const sql = `-- Seed: the ${products.length} products already built into the Airway storefront.
-- Safe to run more than once. Existing rows are left untouched.
insert into public.products (id, name, category, color, price, description, sizes, attributes) values
${rows.join(",\n")}
on conflict (id) do nothing;
`;
fs.writeFileSync(new URL("../supabase/seed.sql", import.meta.url), sql);
console.log("seed rows:", products.length, "missing cat:", products.filter(p => !CAT[p.id]).map(p => p.id));

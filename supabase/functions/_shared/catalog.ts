// Image search categories. Keys match public.categories in the database.
export type Group = "tops" | "bottoms" | "dresses" | "shoes" | "accessories" | "sets";

export interface Category {
  key: string;
  label: string;
  group: Group;
  query: string;          // default product word used in searches
  terms: string[];        // words that prove a photo shows this kind of item
}

export const CATEGORIES: Record<string, Category> = {
  mens_shirts:    { key: "mens_shirts", label: "Men's shirts", group: "tops", query: "men's shirt",
                    terms: ["shirt", "shirts", "button down", "button-down", "oxford", "dress shirt", "linen shirt", "flannel"] },
  tshirts:        { key: "tshirts", label: "T-shirts", group: "tops", query: "t-shirt",
                    terms: ["t-shirt", "t-shirts", "tshirt", "tee", "tees", "polo", "polo shirt"] },
  jeans_trousers: { key: "jeans_trousers", label: "Jeans and trousers", group: "bottoms", query: "trousers",
                    terms: ["jeans", "denim", "trousers", "pants", "chinos", "chino", "cargo pants", "slacks"] },
  hoodies:        { key: "hoodies", label: "Hoodies", group: "tops", query: "hoodie",
                    terms: ["hoodie", "hoodies", "sweatshirt", "hooded", "pullover"] },
  jackets:        { key: "jackets", label: "Jackets", group: "tops", query: "jacket",
                    terms: ["jacket", "jackets", "coat", "bomber", "puffer", "parka", "overcoat", "denim jacket", "trench"] },
  womens_dresses: { key: "womens_dresses", label: "Women's dresses", group: "dresses", query: "dress",
                    terms: ["dress", "dresses", "gown", "maxi", "midi", "sundress", "frock"] },
  shoes:          { key: "shoes", label: "Shoes", group: "shoes", query: "shoes",
                    terms: ["shoe", "shoes", "sneaker", "sneakers", "trainers", "boot", "boots", "loafer", "loafers", "heels", "sandal", "sandals", "footwear", "mule", "mules"] },
  accessories:    { key: "accessories", label: "Accessories", group: "accessories", query: "accessories",
                    terms: ["bag", "handbag", "backpack", "belt", "watch", "cap", "hat", "scarf", "sunglasses", "wallet", "necklace", "bracelet", "earrings", "tie", "accessory", "accessories"] },
  shalwar_kameez: { key: "shalwar_kameez", label: "Shalwar kameez", group: "dresses", query: "kurta",
                    terms: ["kurta", "shalwar", "salwar", "kameez", "traditional dress", "ethnic wear", "dupatta"] },
  mens_suits:     { key: "mens_suits", label: "Men's suits", group: "tops", query: "men's suit",
                    terms: ["suit", "suits", "blazer", "tuxedo", "waistcoat", "formal wear"] },
  outfit_sets:    { key: "outfit_sets", label: "Outfit sets", group: "sets", query: "outfit flat lay",
                    terms: ["outfit", "flat lay", "flatlay", "clothes", "clothing", "apparel", "garments"] },
};

// Words that suggest a clean product shot rather than a lifestyle photo.
export const PRODUCT_WORDS = ["isolated", "white background", "plain background", "flat lay", "flatlay", "hanger", "hanging",
  "mannequin", "product", "studio", "folded", "clothes rack", "on a hanger", "studio shot", "cut out", "cutout"];

// Words that suggest the photo is about a person, not a garment.
export const PEOPLE_WORDS = ["woman", "women", "man", "men", "girl", "boy", "model", "person", "people", "portrait",
  "face", "smiling", "couple", "wedding", "selfie", "posing", "lady", "guy", "child", "kid", "bride", "groom"];

// Never use: watermarks, logos and branded goods.
export const BLOCK_WORDS = ["watermark", "logo", "logos", "trademark", "brand", "branded", "text", "typography", "sign", "advertisement",
  "nike", "adidas", "gucci", "zara", "h&m", "louis vuitton", "puma", "levi's", "levis", "chanel", "prada", "supreme", "reebok",
  "converse", "vans", "balenciaga", "versace", "dior", "hermes", "burberry", "fendi", "new balance", "jordan", "ralph lauren",
  "tommy hilfiger", "calvin klein", "uniqlo", "lacoste", "under armour", "the north face", "rolex", "ray-ban", "ray ban"];

export const LICENSES = {
  pexels: { name: "Pexels License", url: "https://www.pexels.com/license/" },
  unsplash: { name: "Unsplash License", url: "https://unsplash.com/license" },
  pixabay: { name: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/" },
} as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${esc(word.toLowerCase())}([^a-z0-9]|$)`).test(text);
}
export const anyWord = (text: string, words: string[]) => words.filter((w) => hasWord(text, w));

// Terms from other groups that would mean the photo shows something else.
export function conflictTerms(cat: Category): string[] {
  const own = new Set(cat.terms);
  return Object.values(CATEGORIES)
    .filter((c) => c.group !== cat.group && c.group !== "sets" && cat.group !== "sets")
    .flatMap((c) => c.terms)
    .filter((t) => !own.has(t) && !cat.terms.some((o) => hasWord(o, t) || hasWord(t, o)));
}

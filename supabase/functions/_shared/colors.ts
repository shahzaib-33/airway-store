// Color names used for products, their RGB values, and comparison helpers.
export type RGB = [number, number, number];

export const COLORS: Record<string, RGB> = {
  white: [245, 245, 243], "off white": [240, 236, 226], ivory: [240, 234, 214], cream: [238, 230, 212],
  beige: [214, 200, 176], stone: [205, 194, 172], sand: [210, 190, 155], khaki: [189, 176, 133],
  camel: [193, 154, 107], tan: [200, 160, 115], brown: [110, 72, 48], chocolate: [80, 50, 35], tobacco: [138, 90, 60],
  black: [24, 24, 24], charcoal: [58, 58, 60], grey: [140, 140, 140], gray: [140, 140, 140], "light grey": [200, 200, 200], silver: [190, 190, 195],
  navy: [31, 42, 68], blue: [60, 100, 175], "light blue": [160, 190, 225], "sky blue": [150, 195, 235], denim: [90, 125, 170],
  red: [185, 35, 35], maroon: [110, 30, 45], burgundy: [100, 28, 42], wine: [110, 30, 50],
  pink: [232, 170, 182], "hot pink": [220, 60, 140], peach: [245, 200, 175],
  green: [50, 110, 60], "dark green": [36, 71, 58], olive: [110, 113, 64], sage: [155, 174, 143], "sage green": [155, 174, 143], mint: [170, 225, 195],
  yellow: [230, 200, 60], mustard: [205, 160, 40], orange: [225, 120, 40], rust: [175, 80, 40],
  purple: [110, 60, 140], lilac: [200, 170, 220], lavender: [190, 175, 225], teal: [40, 120, 120], turquoise: [60, 190, 190],
  gold: [200, 160, 70],
};

// Provider color filters, only where the mapping is unambiguous.
const BASIC: Record<string, string> = {
  white: "white", "off white": "white", ivory: "white", black: "black", charcoal: "black",
  grey: "gray", gray: "gray", "light grey": "gray", silver: "gray",
  navy: "blue", blue: "blue", "light blue": "blue", "sky blue": "blue", denim: "blue",
  red: "red", maroon: "red", burgundy: "red", wine: "red",
  pink: "pink", "hot pink": "pink", green: "green", "dark green": "green", olive: "green", sage: "green", "sage green": "green", mint: "green",
  yellow: "yellow", mustard: "yellow", orange: "orange", rust: "orange", brown: "brown", chocolate: "brown", tobacco: "brown",
  purple: "purple", lilac: "purple", lavender: "purple", teal: "teal", turquoise: "teal",
};
export function providerColor(provider: "pexels" | "unsplash" | "pixabay", name?: string | null): string | undefined {
  const b = name ? BASIC[name.toLowerCase().trim()] : undefined;
  if (!b) return undefined;
  if (provider === "pexels") return ({ purple: "violet", teal: "turquoise" } as Record<string, string>)[b] ?? b;
  if (provider === "pixabay") return ({ purple: "lilac", teal: "turquoise" } as Record<string, string>)[b] ?? b;
  return b === "gray" ? "black_and_white" : b; // unsplash
}

export function findColorName(text: string): string | undefined {
  const t = ` ${text.toLowerCase()} `;
  return Object.keys(COLORS).sort((a, b) => b.length - a.length).find((c) => t.includes(` ${c} `));
}

export function colorRGB(name?: string | null): RGB | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().trim();
  if (COLORS[n]) return COLORS[n];
  if (/^#?[0-9a-f]{6}$/i.test(n)) return hexToRgb(n);
  const found = findColorName(n);
  return found ? COLORS[found] : undefined;
}

export const hexToRgb = (h: string): RGB => {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
export const rgbToHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

function toLab([r, g, b]: RGB): RGB {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const p = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * p(Y) - 16, 500 * (p(X) - p(Y)), 200 * (p(Y) - p(Z))];
}

// Perceptual color difference (CIE76). Below about 15 looks like the same color family.
export function deltaE(a: RGB, b: RGB): number {
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

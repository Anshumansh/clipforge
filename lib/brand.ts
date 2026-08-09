export type BrandFontKey = "sans" | "serif" | "mono";

export const BRAND_FONT_KEYS: BrandFontKey[] = ["sans", "serif", "mono"];

export const BRAND_FONT_LABELS: Record<BrandFontKey, string> = {
  sans: "Sans-serif (default)",
  serif: "Serif",
  mono: "Monospace",
};

// Only fonts actually installed in the render container (Dockerfile's
// fonts-liberation package) -- Liberation Sans/Serif/Mono are metric
// substitutes for Arial/Times New Roman/Courier New, so these render
// identically in local dev (system fonts) and production (Liberation).
const FONT_STACKS: Record<BrandFontKey, string> = {
  sans: "Arial, 'Liberation Sans', Helvetica, sans-serif",
  serif: "'Liberation Serif', 'Times New Roman', serif",
  mono: "'Liberation Mono', 'Courier New', monospace",
};

export function isBrandFontKey(value: unknown): value is BrandFontKey {
  return value === "sans" || value === "serif" || value === "mono";
}

export function resolveFontFamily(key?: string | null): string {
  return isBrandFontKey(key) ? FONT_STACKS[key] : FONT_STACKS.sans;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

export interface BrandSettings {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
}

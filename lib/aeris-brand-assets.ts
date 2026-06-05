/** Public paths for AERIS brand assets used in loading UI. */
export const AERIS_BRAND = {
  logo: "/assets/AERIS%20LOGO.svg",
  glyph: "/assets/aeris-glyph.png",
  char: "/assets/AERIS_char.svg",
} as const;

export const AERIS_GLYPH_DIM = { width: 1065, height: 1214 } as const;

/** AERIS_char.svg viewBox — artwork is clipped to the right ~43% of the canvas. */
export const AERIS_CHAR_VIEWBOX = {
  width: 1440,
  height: 810,
  cropX: 816,
} as const;

export const AERIS_CHAR_VISIBLE_W =
  AERIS_CHAR_VIEWBOX.width - AERIS_CHAR_VIEWBOX.cropX;

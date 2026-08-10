/** Public paths for AERIS brand assets used in loading UI. */
export const AERIS_BRAND = {
  logo: "/assets/AERIS%20LOGO.svg",
  glyph: "/assets/aeris-glyph.png",
  char: "/assets/AERIS_char.svg",
} as const;

// `@` must be percent-encoded as %40: Next's static handler 404s the literal
// form. Verified against a production build — /assets/Bagyo%20Logo@5x.png
// returns 404, /assets/Bagyo%20Logo%405x.png returns 200. The sidebar logo
// (components/Sidebar.tsx) has been rendering broken; the login page and the
// mobile gate already hardcoded the encoded form, which is why it went unseen.
export const BAGYO_LOGO = "/assets/Bagyo%20Logo%405x.png";
export const SIDEBAR_AD_GIF = "/assets/ads_v2_2026.gif";

export const AERIS_GLYPH_DIM = { width: 1065, height: 1214 } as const;

/** AERIS_char.svg viewBox — artwork is clipped to the right ~43% of the canvas. */
export const AERIS_CHAR_VIEWBOX = {
  width: 1440,
  height: 810,
  cropX: 816,
} as const;

export const AERIS_CHAR_VISIBLE_W =
  AERIS_CHAR_VIEWBOX.width - AERIS_CHAR_VIEWBOX.cropX;

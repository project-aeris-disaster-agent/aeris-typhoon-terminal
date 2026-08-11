/**
 * Estimated wind-field extent from storm intensity.
 *
 * Neither upstream reports wind radii: the GDACS eventlist has none (the
 * renderer's `rings` layer, which expects per-point kt60/kt30/kt15 radii, has
 * never drawn), and the PAGASA daily advisory states only center winds and
 * gustiness. What both always state is intensity — so the map draws a disc
 * sized by climatological medians for Western North Pacific cyclones of that
 * category (roughly JTWC R34/R50 medians, rounded).
 *
 * These are typical extents, not measurements — actual wind fields are
 * asymmetric and vary storm to storm by a factor of two. The renderer styles
 * the disc dashed and labels it "(EST.)" for the same reason the trajectory
 * ray is dashed: on this map, solid means reported, dashed means derived.
 * If real radii ever arrive (PAGASA bulletin prose, GDACS per-event
 * geometry), the `rings` layer takes over and this estimate should yield.
 */

export type WindFieldEstimate = {
  /** Radius of gale-force winds (≥62 km/h), km. */
  galeKm: number;
  /** Radius of storm-force winds (≥89 km/h), km; null below STS intensity. */
  stormKm: number | null;
};

/**
 * PAGASA category thresholds (km/h): TD <62, TS 62–88, STS 89–117,
 * TY 118–184, STY ≥185.
 */
export function estimateWindField(windKph: number | null | undefined): WindFieldEstimate | null {
  if (!windKph || !Number.isFinite(windKph)) return null;
  // A tropical depression has no gale-force field by definition. Drawing a
  // circle for one would be invention, not estimation.
  if (windKph < 62) return null;
  if (windKph < 89) return { galeKm: 150, stormKm: null };
  if (windKph < 118) return { galeKm: 200, stormKm: 60 };
  if (windKph < 185) return { galeKm: 260, stormKm: 90 };
  return { galeKm: 320, stormKm: 110 };
}

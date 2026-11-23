"use client";

import { useEffect, useState } from "react";

/**
 * Live `window.matchMedia` result. Returns `null` until mounted (SSR and the
 * first client render), so callers can render nothing rather than guess and
 * then mount the wrong tree.
 *
 * Used to mount ONE layout tree instead of a desktop and a mobile copy hidden
 * with CSS: hidden copies still mount, poll their feeds and fire map events
 * (audit 2026-11, P7 / B9).
 */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setMatches(false);
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind `md` (768px): desktop ops sidebar vs. mobile Reports tab. */
export const MD_UP = "(min-width: 768px)";
/** Tailwind `lg` (1024px): floating map chrome vs. in-flow chrome above the map. */
export const LG_UP = "(min-width: 1024px)";

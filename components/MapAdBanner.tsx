"use client";

import { clsx } from "clsx";

export function MapAdBanner({ className }: { className?: string }) {
  return (
    <a
      href="https://www.google.com/adsense"
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "block w-full rounded-xl overflow-hidden bg-aeris-surface shadow-pill border border-aeris-surface opacity-95 hover:opacity-100 transition-opacity duration-200",
        // Compact strip whenever the chrome is in-flow above the map (< lg);
        // natural height for the floating overlay on large screens.
        "h-[72px] lg:h-auto",
        className,
      )}
      aria-label="Advertisement"
    >
      <img
        src="/ads/ads_v1_2026.gif"
        alt="Advertisement"
        // contain, not cover: the compact phone strip was cropping the creative
        // at both ends (audit 2026-11).
        className="w-full h-full lg:h-auto lg:max-h-none object-contain object-center block"
        draggable={false}
      />
    </a>
  );
}

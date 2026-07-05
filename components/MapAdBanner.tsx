"use client";

import { clsx } from "clsx";

export function MapAdBanner({ className }: { className?: string }) {
  return (
    <a
      href="https://www.google.com/adsense"
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "block w-full rounded-lg overflow-hidden shadow-lg opacity-90 hover:opacity-100 transition-opacity duration-200",
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
        className="w-full h-full lg:h-auto lg:max-h-none object-cover object-center block"
        draggable={false}
      />
    </a>
  );
}

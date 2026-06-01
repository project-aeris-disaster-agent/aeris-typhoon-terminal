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
        "h-[72px] md:h-auto",
        className,
      )}
      aria-label="Advertisement"
    >
      <img
        src="/ads/ads_v1_2026.gif"
        alt="Advertisement"
        className="w-full h-full md:h-auto md:max-h-none object-cover object-center block"
        draggable={false}
      />
    </a>
  );
}

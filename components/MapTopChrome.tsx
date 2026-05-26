"use client";

import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import {
  MapSearchBar,
  type SelectedLocation,
} from "@/components/MapSearchBar";

export function MapTopChrome({
  map,
  onAddressSelect,
  className,
}: {
  map: MLMap | null;
  onAddressSelect: (target: SelectedLocation) => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-stretch gap-1.5 md:gap-2 w-full max-w-[480px] mx-auto",
        className,
      )}
    >
      <a
        href="https://www.google.com/adsense"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full rounded-lg overflow-hidden shadow-lg opacity-90 hover:opacity-100 transition-opacity duration-200"
        aria-label="Advertisement"
      >
        <img
          src="/ads/ads_v1_2026.gif"
          alt="Advertisement"
          className="w-full h-auto max-h-[72px] md:max-h-none object-cover object-center block"
          draggable={false}
        />
      </a>
      <MapSearchBar map={map} onAddressSelect={onAddressSelect} />
    </div>
  );
}

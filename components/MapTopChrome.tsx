"use client";

import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import {
  MapSearchBar,
  type SelectedLocation,
} from "@/components/MapSearchBar";
import { MapAdBanner } from "@/components/MapAdBanner";

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
      <MapAdBanner />
      <MapSearchBar map={map} onAddressSelect={onAddressSelect} />
    </div>
  );
}

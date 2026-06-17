"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CloudRain,
  Newspaper,
  Satellite,
  Wind,
} from "lucide-react";
import { clsx } from "clsx";
import type { PanelId } from "@/config/panels";

const PANEL_ICON_MAP: Record<PanelId, LucideIcon> = {
  typhoon: Wind,
  satellite: Satellite,
  forecast: CloudRain,
  alerts: AlertTriangle,
  news: Newspaper,
};

export function PanelIcon({
  id,
  size = 13,
  className,
}: {
  id: PanelId;
  size?: number;
  className?: string;
}) {
  const Icon = PANEL_ICON_MAP[id];
  return (
    <Icon
      size={size}
      className={clsx("shrink-0 text-aeris-accent/70", className)}
      aria-hidden
    />
  );
}

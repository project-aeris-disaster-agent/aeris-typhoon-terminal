"use client";

import type { DynamicOptionsLoadingProps } from "next/dynamic";
import { clsx } from "clsx";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";

type PanelSkeletonProps = {
  label?: string;
  className?: string;
};

export function PanelSkeleton({
  label = "Loading panel…",
  className,
}: PanelSkeletonProps & DynamicOptionsLoadingProps) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center gap-2 py-6 text-aeris-muted",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <AerisLoadingLogo size="sm" variant="glyph" />
      <span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>
    </div>
  );
}

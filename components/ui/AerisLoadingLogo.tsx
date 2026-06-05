"use client";

import { clsx } from "clsx";
import { AERIS_BRAND, AERIS_CHAR_VIEWBOX, AERIS_CHAR_VISIBLE_W } from "@/lib/aeris-brand-assets";

type AerisLoadingLogoProps = {
  size?: "sm" | "md" | "lg";
  /** glyph = spinner mark, logo = wordmark, char = mascot, splash = glyph (boot screens). */
  variant?: "glyph" | "logo" | "char" | "splash";
  /** Multiplier for char variant height (e.g. 3 = 300% of default). */
  scale?: number;
  pulse?: boolean;
  spin?: boolean;
  className?: string;
};

const GLYPH_PX = { sm: 40, md: 56, lg: 72 } as const;
const LOGO_W = { sm: 128, md: 200, lg: 280 } as const;
const CHAR_H = { sm: 52, md: 80, lg: 128 } as const;

function AerisGlyph({
  size,
  spin,
  pulse,
  className,
}: {
  size: keyof typeof GLYPH_PX;
  spin: boolean;
  pulse: boolean;
  className?: string;
}) {
  const px = GLYPH_PX[size];
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={AERIS_BRAND.glyph}
      alt=""
      aria-hidden
      decoding="async"
      fetchPriority={size === "lg" ? "high" : "auto"}
      className={clsx(
        "block h-full w-auto max-w-full object-contain",
        pulse && !spin && "aeris-loading-pulse",
      )}
    />
  );

  if (spin) {
    return (
      <div
        className={clsx("aeris-loading-glyph-spin shrink-0", className)}
        style={{ width: px, height: px }}
        aria-hidden
      >
        {img}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={AERIS_BRAND.glyph}
      alt=""
      aria-hidden
      decoding="async"
      className={clsx(
        "h-auto w-auto shrink-0 object-contain",
        pulse && "aeris-loading-pulse",
        className,
      )}
      style={{ height: px, width: "auto" }}
    />
  );
}

const SPLASH_TITLE = {
  sm: "text-[10px] tracking-[0.18em]",
  md: "text-[11px] tracking-[0.2em]",
  lg: "text-xs sm:text-sm tracking-[0.22em]",
} as const;

/** Crops empty left padding baked into AERIS_char.svg so the figure centers visually. */
export function AerisCharIllustration({
  size,
  scale = 1,
  className,
}: {
  size: keyof typeof CHAR_H;
  /** Multiplier applied to the base height (e.g. 3 = 300% of default). */
  scale?: number;
  className?: string;
}) {
  const heightPx = Math.round(CHAR_H[size] * scale);
  const widthPx = Math.round(
    (heightPx * AERIS_CHAR_VISIBLE_W) / AERIS_CHAR_VIEWBOX.height,
  );
  const offsetPx = Math.round(
    (heightPx * AERIS_CHAR_VIEWBOX.cropX) / AERIS_CHAR_VIEWBOX.height,
  );

  return (
    <div
      className={clsx("relative mx-auto shrink-0 overflow-hidden", className)}
      style={{ height: heightPx, width: widthPx }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={AERIS_BRAND.char}
        alt=""
        aria-hidden
        className="absolute top-0 block h-full w-auto max-w-none"
        style={{ left: -offsetPx }}
      />
    </div>
  );
}

export function AerisLoadingLogo({
  size = "md",
  variant,
  scale = 1,
  pulse = false,
  spin,
  className,
}: AerisLoadingLogoProps) {
  const resolvedVariant = variant ?? (size === "lg" ? "splash" : "glyph");
  const shouldSpin = spin ?? (resolvedVariant === "glyph" || resolvedVariant === "splash");
  const shouldPulse = pulse && resolvedVariant !== "splash";

  if (resolvedVariant === "logo") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={AERIS_BRAND.logo}
        alt="AERIS"
        className={clsx(
          "h-auto w-auto object-contain",
          shouldPulse && "aeris-loading-pulse",
          className,
        )}
        style={{ maxWidth: LOGO_W[size] }}
      />
    );
  }

  if (resolvedVariant === "char") {
    return (
      <AerisCharIllustration size={size} scale={scale} className={className} />
    );
  }

  if (resolvedVariant === "glyph") {
    return (
      <AerisGlyph
        size={size}
        spin={shouldSpin}
        pulse={shouldPulse}
        className={className}
      />
    );
  }

  return (
    <div
      className={clsx(
        "mx-auto flex w-full max-w-sm flex-col items-center gap-3 sm:max-w-md sm:gap-4",
        className,
      )}
    >
      <p
        className={clsx(
          "w-full text-center font-mono font-semibold uppercase text-aeris-text",
          SPLASH_TITLE[size],
        )}
      >
        <span className="text-aeris-accent">A.E.R.I.S.</span> Disaster Reporting
        Terminal
      </p>
      <div className="flex w-full flex-col items-center justify-center gap-3">
        <AerisGlyph size={size} spin={shouldSpin} pulse={false} className="mx-auto" />
      </div>
    </div>
  );
}

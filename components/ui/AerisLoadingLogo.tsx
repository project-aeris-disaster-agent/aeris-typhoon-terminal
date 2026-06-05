"use client";

import Image from "next/image";
import { clsx } from "clsx";
import { AERIS_BRAND, AERIS_GLYPH_DIM } from "@/lib/aeris-brand-assets";

type AerisLoadingLogoProps = {
  size?: "sm" | "md" | "lg";
  /** glyph = spinner mark, logo = wordmark, char = mascot, splash = all three (boot screens). */
  variant?: "glyph" | "logo" | "char" | "splash";
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
  priority,
}: {
  size: keyof typeof GLYPH_PX;
  spin: boolean;
  pulse: boolean;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={AERIS_BRAND.glyph}
      alt=""
      aria-hidden
      width={AERIS_GLYPH_DIM.width}
      height={AERIS_GLYPH_DIM.height}
      priority={priority}
      className={clsx(
        "h-auto w-auto shrink-0 object-contain",
        spin && "aeris-loading-glyph-spin",
        pulse && !spin && "aeris-loading-pulse",
        className,
      )}
      style={{ height: GLYPH_PX[size], width: "auto" }}
    />
  );
}

export function AerisLoadingLogo({
  size = "md",
  variant,
  pulse = false,
  spin,
  className,
}: AerisLoadingLogoProps) {
  const resolvedVariant = variant ?? (size === "lg" ? "splash" : "glyph");
  const shouldSpin = spin ?? (resolvedVariant === "glyph" || resolvedVariant === "splash");
  const shouldPulse = pulse || resolvedVariant === "splash";

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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={AERIS_BRAND.char}
        alt=""
        aria-hidden
        className={clsx(
          "h-auto w-auto object-contain",
          shouldPulse && "aeris-loading-pulse",
          className,
        )}
        style={{ maxHeight: CHAR_H[size] }}
      />
    );
  }

  if (resolvedVariant === "glyph") {
    return (
      <AerisGlyph
        size={size}
        spin={shouldSpin}
        pulse={shouldPulse}
        className={className}
        priority={size === "lg"}
      />
    );
  }

  return (
    <div className={clsx("flex flex-col items-center gap-3", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={AERIS_BRAND.logo}
        alt="AERIS"
        className={clsx("h-auto object-contain", shouldPulse && "aeris-loading-pulse")}
        style={{ maxWidth: LOGO_W[size] }}
      />
      <div className="flex items-end justify-center gap-3 sm:gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AERIS_BRAND.char}
          alt=""
          aria-hidden
          className="h-auto object-contain object-bottom"
          style={{ maxHeight: CHAR_H[size] }}
        />
        <AerisGlyph size={size} spin={shouldSpin} pulse={false} priority />
      </div>
    </div>
  );
}

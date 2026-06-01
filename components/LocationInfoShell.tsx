"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { ChevronUp } from "lucide-react";

/** Matches `Header` (`h-12`). */
export const AERIS_HEADER_H = "3rem";
/** Matches collapsed `BottomPanel` (`h-8`). */
export const AERIS_INTEL_FEEDS_COLLAPSED_H = "2rem";
/** Matches expanded `BottomPanel` default height. */
export const AERIS_INTEL_FEEDS_EXPANDED_H = "38vh";
/** Matches `MobileTabBar` (`h-14`). */
export const AERIS_MOBILE_TABBAR_H = "3.5rem";

const shellStyle = (intelFeedsCollapsed: boolean): CSSProperties => ({
  ["--aeris-header-h" as string]: AERIS_HEADER_H,
  ["--aeris-intel-feeds-h" as string]: intelFeedsCollapsed
    ? AERIS_INTEL_FEEDS_COLLAPSED_H
    : AERIS_INTEL_FEEDS_EXPANDED_H,
  ["--aeris-mobile-tabbar-h" as string]: AERIS_MOBILE_TABBAR_H,
});

export function LocationInfoShell({
  intelFeedsCollapsed,
  locationKey,
  onClose,
  children,
}: {
  intelFeedsCollapsed: boolean;
  /** Changes when the selected pin changes — resets mobile sheet peek. */
  locationKey: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [sheetExpanded, setSheetExpanded] = useState(true);

  useEffect(() => {
    setSheetExpanded(true);
  }, [locationKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleSheet = useCallback(() => {
    setSheetExpanded((v) => !v);
  }, []);

  const style = shellStyle(intelFeedsCollapsed);

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close location info"
        className="md:hidden fixed inset-x-0 top-0 z-[18] bg-black/40"
        style={{ bottom: AERIS_MOBILE_TABBAR_H }}
        onClick={onClose}
      />

      {/* Mobile bottom sheet */}
      <div
        className={clsx(
          "md:hidden fixed inset-x-0 z-20 flex flex-col pointer-events-auto",
          "rounded-t-xl border border-aeris-border/70 border-b-0",
          "panel-glass shadow-2xl transition-[height] duration-300 ease-out",
        )}
        style={{
          ...style,
          bottom: AERIS_MOBILE_TABBAR_H,
          height: sheetExpanded
            ? `min(calc(100dvh - ${AERIS_HEADER_H} - ${AERIS_MOBILE_TABBAR_H} - 0.5rem), 85dvh)`
            : "40dvh",
          maxHeight: `calc(100dvh - ${AERIS_HEADER_H} - ${AERIS_MOBILE_TABBAR_H} - 0.5rem)`,
        }}
      >
        <div className="shrink-0 flex flex-col items-center pt-1.5 pb-0.5 border-b border-aeris-border/40">
          <button
            type="button"
            onClick={toggleSheet}
            className="w-full flex flex-col items-center gap-1 py-1 text-aeris-muted hover:text-aeris-text"
            aria-expanded={sheetExpanded}
            aria-label={sheetExpanded ? "Collapse location panel" : "Expand location panel"}
          >
            <span className="w-10 h-1 rounded-full bg-aeris-border" aria-hidden />
            <ChevronUp
              size={14}
              className={clsx(
                "transition-transform duration-300",
                sheetExpanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>

      {/* Desktop floating card — sits above MapLibre attribution (bottom-right). */}
      <div
        className={clsx(
          "hidden md:flex md:flex-col pointer-events-auto min-h-0 overflow-hidden",
          "absolute right-3 z-20 w-[min(360px,calc(100vw-1.5rem))]",
          "max-h-[min(520px,calc(100%-1.5rem-var(--aeris-map-attribution-reserve)-0.75rem))]",
        )}
        style={{
          bottom: "calc(0.75rem + var(--aeris-map-attribution-reserve))",
        }}
      >
        <div className="flex min-h-0 max-h-full w-full flex-col">{children}</div>
      </div>
    </>
  );
}

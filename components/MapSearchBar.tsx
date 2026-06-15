"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import type { GeocodeKind, GeocodeSuggestion } from "@/lib/geocode";
import { suggestionSecondaryLine } from "@/lib/geocode";

export type SelectedLocation = {
  lat: number;
  lon: number;
  shortName: string;
  breadcrumb: string;
  typeLabel: string;
  kind?: GeocodeKind;
  zoom?: number;
};

const TYPE_TONE: Record<string, string> = {
  Address: "text-aeris-warn",
  Building: "text-aeris-warn",
  Street: "text-aeris-warn",
  Barangay: "text-aeris-accent",
  Town: "text-aeris-ok",
  City: "text-aeris-ok",
  Municipality: "text-aeris-ok",
};

function toneForTypeLabel(typeLabel: string): string {
  return TYPE_TONE[typeLabel] ?? "text-aeris-muted";
}

function viewboxFromMap(map: MLMap | null | undefined): string | null {
  if (!map) return null;
  const b = map.getBounds();
  return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MapSearchBar({
  map,
  onAddressSelect,
}: {
  map?: MLMap | null;
  onAddressSelect?: (target: SelectedLocation) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const flyTo = useCallback(
    (lat: number, lon: number, zoom: number) => {
      if (!map) return;
      map.flyTo({
        center: [lon, lat],
        zoom,
        duration: 2000,
        essential: true,
      });
    },
    [map],
  );

  const runSearch = useCallback(
    (q: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!q.trim() || q.length < 2) {
        setSuggestions([]);
        setDropdownOpen(false);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchTimer.current = setTimeout(async () => {
        try {
          const params = new URLSearchParams({ q });
          const viewbox = viewboxFromMap(map);
          if (viewbox) params.set("viewbox", viewbox);
          const res = await fetch(`/api/geocode/search?${params.toString()}`, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = (await res.json()) as {
              suggestions?: GeocodeSuggestion[];
            };
            const list = data.suggestions ?? [];
            setSuggestions(list);
            setDropdownOpen(list.length > 0);
            setActiveIdx(-1);
          } else if (res.status === 429) {
            setSuggestions([]);
            setDropdownOpen(false);
          }
        } catch {
          // silent
        } finally {
          setSearching(false);
        }
      }, 350);
    },
    [map],
  );

  const handleQueryChange = useCallback(
    (val: string) => {
      setQuery(val);
      if (!val) {
        setSuggestions([]);
        setDropdownOpen(false);
      } else {
        runSearch(val);
      }
    },
    [runSearch],
  );

  const selectSuggestion = useCallback(
    (s: GeocodeSuggestion) => {
      setQuery(s.shortName);
      setSuggestions([]);
      setDropdownOpen(false);
      flyTo(s.lat, s.lon, s.zoom);
      void onAddressSelect?.({
        lat: s.lat,
        lon: s.lon,
        shortName: s.shortName,
        breadcrumb: s.breadcrumb,
        typeLabel: s.typeLabel,
        kind: s.kind,
        zoom: s.zoom,
      });
      inputRef.current?.blur();
    },
    [flyTo, onAddressSelect],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!dropdownOpen || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIdx >= 0 && activeIdx < suggestions.length) {
          selectSuggestion(suggestions[activeIdx]);
        }
      } else if (e.key === "Escape") {
        setSuggestions([]);
        setDropdownOpen(false);
        setActiveIdx(-1);
      }
    },
    [dropdownOpen, suggestions, activeIdx, selectSuggestion],
  );

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <div className="relative w-full">
      <div
        className={clsx(
          "group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 shadow-lg",
          isFocused || query
            ? "bg-aeris-surface/98 border border-aeris-accent/40 shadow-aeris-accent/10"
            : "bg-aeris-surface/95 border border-aeris-border/70 hover:border-aeris-border",
        )}
      >
        <svg
          className={clsx(
            "shrink-0 transition-colors duration-200",
            isFocused || query ? "text-aeris-accent" : "text-aeris-muted/50",
          )}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            suggestions.length > 0 && setDropdownOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          placeholder="Search address, street, barangay, or city…"
          className="flex-1 bg-transparent text-body-sm text-aeris-text placeholder:text-aeris-muted/40 outline-none min-w-0 font-medium"
          autoComplete="off"
          spellCheck={false}
        />

        {!isFocused && !query && (
          <span className="shrink-0 hud-text text-chrome text-aeris-muted/50 tracking-widest uppercase hidden sm:inline">
            PH
          </span>
        )}

        {searching && (
          <span className="shrink-0 inline-flex gap-1">
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" style={{ animationDelay: "0.15s" }} />
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" style={{ animationDelay: "0.3s" }} />
          </span>
        )}

        {query && !searching && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSuggestions([]);
              setDropdownOpen(false);
              inputRef.current?.focus();
            }}
            className="shrink-0 text-aeris-muted/60 hover:text-aeris-text transition-colors leading-none p-0.5"
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {dropdownOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 bg-aeris-surface border border-aeris-border/80 rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {suggestions.map((s, i) => {
            const secondary = suggestionSecondaryLine(s);
            const typeTone = toneForTypeLabel(s.typeLabel);
            return (
              <li key={s.id} role="option" aria-selected={i === activeIdx}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={clsx(
                    "w-full text-left px-3 py-2 transition-all duration-150 flex items-start gap-2 border-b border-aeris-border/20 last:border-0",
                    i === activeIdx
                      ? "bg-aeris-accent/8 border-l-2 border-l-aeris-accent pl-[11px]"
                      : "hover:bg-aeris-elev/40",
                  )}
                >
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="text-body-sm text-aeris-text truncate font-semibold">
                      {s.shortName}
                    </div>
                    {secondary && (
                      <div className="text-body-sm text-aeris-muted/70 truncate mt-0.5">
                        {secondary}
                      </div>
                    )}
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 text-chrome font-mono uppercase tracking-wider font-bold mt-0.5 px-1.5 py-0.5 rounded-full border",
                      typeTone,
                      "border-current border-opacity-30",
                    )}
                  >
                    {s.typeLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

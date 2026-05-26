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

export type SelectedLocation = {
  lat: number;
  lon: number;
  shortName: string;
  breadcrumb: string;
  typeLabel: string;
};

// ─── Nominatim ────────────────────────────────────────────────────────────────

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  address: Record<string, string | undefined>;
};

const PLACE_TYPE_LABEL: Record<string, string> = {
  suburb: "Barangay",
  village: "Barangay",
  quarter: "Barangay",
  neighbourhood: "Barangay",
  hamlet: "Barangay",
  isolated_dwelling: "Barangay",
  allotments: "Barangay",
  town: "Town",
  city: "City",
  municipality: "Municipality",
  county: "Province",
  state: "Region",
  administrative: "Area",
};

const PLACE_TONE: Record<string, string> = {
  suburb: "text-aeris-accent",
  village: "text-aeris-accent",
  quarter: "text-aeris-accent",
  neighbourhood: "text-aeris-accent",
  hamlet: "text-aeris-accent",
  isolated_dwelling: "text-aeris-accent",
  allotments: "text-aeris-accent",
  town: "text-aeris-ok",
  city: "text-aeris-ok",
  municipality: "text-aeris-ok",
};

function nominatimShortName(r: NominatimResult): string {
  const a = r.address;
  return (
    a.suburb ??
    a.village ??
    a.hamlet ??
    a.city_district ??
    a.town ??
    a.city ??
    a.county ??
    r.display_name.split(",")[0].trim()
  );
}

function nominatimBreadcrumb(r: NominatimResult): string {
  const a = r.address;
  const parts: string[] = [];
  const sub = a.suburb ?? a.village ?? a.hamlet;
  if (sub && (a.city || a.town)) parts.push(a.city ?? a.town ?? "");
  if (a.county) parts.push(a.county);
  if (a.state) parts.push(a.state);
  return parts.filter(Boolean).join(" · ");
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
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const flyTo = useCallback(
    (lat: number, lon: number) => {
      if (!map) return;
      map.flyTo({
        center: [lon, lat],
        zoom: 15,
        duration: 2000,
        essential: true,
      });
    },
    [map],
  );

  const runSearch = useCallback((q: string) => {
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
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", q);
        url.searchParams.set("countrycodes", "ph");
        url.searchParams.set("format", "json");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "10");
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as NominatimResult[];
          setSuggestions(data);
          setDropdownOpen(data.length > 0);
          setActiveIdx(-1);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 350);
  }, []);

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
    (r: NominatimResult) => {
      const shortName = nominatimShortName(r);
      const breadcrumb = nominatimBreadcrumb(r);
      const typeLabel = PLACE_TYPE_LABEL[r.type] ?? r.class;
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      setQuery(shortName);
      setSuggestions([]);
      setDropdownOpen(false);
      flyTo(lat, lon);
      void onAddressSelect?.({ lat, lon, shortName, breadcrumb, typeLabel });
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
      {/* Search input */}
      <div
        className={clsx(
          "group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 shadow-lg",
          isFocused || query
            ? "bg-aeris-surface/98 border border-aeris-accent/40 shadow-aeris-accent/10"
            : "bg-aeris-surface/95 border border-aeris-border/70 hover:border-aeris-border",
        )}
      >
        {/* Search icon */}
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
          placeholder="Search any location in the Philippines…"
          className="flex-1 bg-transparent text-[12px] text-aeris-text placeholder:text-aeris-muted/40 outline-none min-w-0 font-medium"
          autoComplete="off"
          spellCheck={false}
        />

        {/* HUD label */}
        {!isFocused && !query && (
          <span className="shrink-0 hud-text text-[9px] text-aeris-muted/50 tracking-widest uppercase hidden sm:inline">
            PH
          </span>
        )}

        {/* Spinner */}
        {searching && (
          <span className="shrink-0 inline-flex gap-1">
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" style={{ animationDelay: "0.15s" }} />
            <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse" style={{ animationDelay: "0.3s" }} />
          </span>
        )}

        {/* Clear button */}
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

      {/* Suggestions dropdown */}
      {dropdownOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 bg-aeris-surface border border-aeris-border/80 rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {suggestions.map((r, i) => {
            const shortName = nominatimShortName(r);
            const breadcrumb = nominatimBreadcrumb(r);
            const typeLabel = PLACE_TYPE_LABEL[r.type] ?? r.class;
            const typeTone = PLACE_TONE[r.type] ?? "text-aeris-muted";
            return (
              <li key={r.place_id} role="option" aria-selected={i === activeIdx}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(r);
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
                    <div className="text-[12px] text-aeris-text truncate font-semibold">
                      {shortName}
                    </div>
                    {breadcrumb && (
                      <div className="text-[10px] text-aeris-muted/70 truncate mt-0.5">
                        {breadcrumb}
                      </div>
                    )}
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 text-[8px] font-mono uppercase tracking-wider font-bold mt-0.5 px-1.5 py-0.5 rounded-full border",
                      typeTone,
                      "border-current border-opacity-30",
                    )}
                  >
                    {typeLabel}
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

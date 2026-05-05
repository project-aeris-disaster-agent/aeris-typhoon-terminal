"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
import { Pill } from "../ui/Card";
import { clsx } from "clsx";
import type { Map as MLMap } from "maplibre-gl";
import type { Address3DTarget } from "@/services/map-scene";
import { AgentAerisPanel } from "./AgentAerisPanel";
import {
  fetchRegions,
  fetchProvincesByRegion,
  fetchMunicipalitiesByProvince,
  fetchBarangaysByMunicipality,
  REGION_ABBREV,
  type PsgcRegion,
  type PsgcProvince,
  type PsgcMunicipality,
  type PsgcBarangay,
} from "@/config/barangays";

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

// ─── Selected Location ────────────────────────────────────────────────────────

type SelectedLocation = {
  name: string;
  breadcrumb: string;
  lat: number;
  lon: number;
  type: string;
  displayName: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
}: {
  label: string;
  value?: string | number;
}) {
  return (
    <div className="flex items-center justify-between py-[5px] text-[10px]">
      <span className="text-aeris-muted/70 font-mono font-semibold">{label}</span>
      <span className="text-aeris-text/90 font-mono font-medium tabular-nums">
        {value !== undefined ? String(value) : "—"}
      </span>
    </div>
  );
}

function SelectDropdown<T extends { code: string; name: string }>({
  label,
  options,
  value,
  onChange,
  loading,
  disabled,
}: {
  label: string;
  options: T[];
  value: string;
  onChange: (val: string) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-mono text-aeris-muted/70 uppercase tracking-widest font-semibold">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        className="w-full bg-aeris-bg/60 border border-aeris-border/60 rounded-md px-2.5 py-1.5 text-[11px] text-aeris-text disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-aeris-accent/60 focus:ring-1 focus:ring-aeris-accent/20 transition-all"
      >
        <option value="">
          {loading ? "Loading…" : `— Select ${label} —`}
        </option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LocationInfoPanel({
  map,
  onAddressSelect,
}: {
  map?: MLMap | null;
  onAddressSelect?: (target: Address3DTarget) => void | Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"location" | "agent">("agent");

  // ── Search state ────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // ── Selected location ───────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedLocation | null>(null);

  // ── Browse state ────────────────────────────────────────────────
  const [browseOpen, setBrowseOpen] = useState(false);
  const [regions, setRegions] = useState<PsgcRegion[]>([]);
  const [provinces, setProvinces] = useState<PsgcProvince[]>([]);
  const [municipalities, setMunicipalities] = useState<PsgcMunicipality[]>([]);
  const [barangays, setBarangays] = useState<PsgcBarangay[]>([]);
  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [municipalityCode, setMunicipalityCode] = useState("");
  const [barangayCode, setBarangayCode] = useState("");
  const [selectedPsgc, setSelectedPsgc] = useState<PsgcBarangay | null>(null);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  // ── Load regions on mount ────────────────────────────────────────
  useEffect(() => {
    fetchRegions()
      .then(setRegions)
      .catch(() => {});
  }, []);

  // ── Nominatim search ─────────────────────────────────────────────
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
        setSelected(null);
      } else {
        runSearch(val);
      }
    },
    [runSearch],
  );

  // ── Fly to coordinates ────────────────────────────────────────────
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

  // ── Select a Nominatim suggestion ─────────────────────────────────
  const selectSuggestion = useCallback(
    (r: NominatimResult) => {
      const loc: SelectedLocation = {
        name: nominatimShortName(r),
        breadcrumb: nominatimBreadcrumb(r),
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        type: PLACE_TYPE_LABEL[r.type] ?? r.class,
        displayName: r.display_name,
      };
      setSelected(loc);
      setQuery(loc.name);
      setSuggestions([]);
      setDropdownOpen(false);
      setSelectedPsgc(null);
      flyTo(loc.lat, loc.lon);
      void onAddressSelect?.({ lat: loc.lat, lon: loc.lon });
      inputRef.current?.blur();
    },
    [flyTo, onAddressSelect],
  );

  // ── Keyboard navigation ──────────────────────────────────────────
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

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // ── PSGC browse handlers ─────────────────────────────────────────
  const handleRegionChange = useCallback(async (code: string) => {
    setRegionCode(code);
    setProvinceCode("");
    setMunicipalityCode("");
    setBarangayCode("");
    setSelectedPsgc(null);
    setProvinces([]);
    setMunicipalities([]);
    setBarangays([]);
    if (!code) return;
    setLoadingStep("province");
    try {
      setProvinces(await fetchProvincesByRegion(code));
    } finally {
      setLoadingStep(null);
    }
  }, []);

  const handleProvinceChange = useCallback(async (code: string) => {
    setProvinceCode(code);
    setMunicipalityCode("");
    setBarangayCode("");
    setSelectedPsgc(null);
    setMunicipalities([]);
    setBarangays([]);
    if (!code) return;
    setLoadingStep("municipality");
    try {
      setMunicipalities(await fetchMunicipalitiesByProvince(code));
    } finally {
      setLoadingStep(null);
    }
  }, []);

  const handleMunicipalityChange = useCallback(async (code: string) => {
    setMunicipalityCode(code);
    setBarangayCode("");
    setSelectedPsgc(null);
    setBarangays([]);
    if (!code) return;
    setLoadingStep("barangay");
    try {
      setBarangays(await fetchBarangaysByMunicipality(code));
    } finally {
      setLoadingStep(null);
    }
  }, []);

  const handleBarangayChange = useCallback(
    async (code: string) => {
      setBarangayCode(code);
      const found = barangays.find((b) => b.code === code) ?? null;
      setSelectedPsgc(found);
      setSelected(null);
      if (!found) return;

      // Geocode via Nominatim using full address
      const muni = municipalities.find((m) => m.code === municipalityCode);
      const prov = provinces.find((p) => p.code === provinceCode);
      const q = [found.name, muni?.name, prov?.name, "Philippines"]
        .filter(Boolean)
        .join(", ");
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", q);
        url.searchParams.set("countrycodes", "ph");
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "1");
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as NominatimResult[];
          if (data[0]) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            flyTo(lat, lon);
            void onAddressSelect?.({ lat, lon });
          }
        }
      } catch {
        // silent — flyTo is best-effort
      }
    },
    [
      barangays,
      municipalities,
      provinces,
      municipalityCode,
      provinceCode,
      flyTo,
      onAddressSelect,
    ],
  );

  // ── Breadcrumb for PSGC selection ────────────────────────────────
  const regionName = regions.find((r) => r.code === regionCode)?.name ?? "";
  const provinceName = provinces.find((p) => p.code === provinceCode)?.name ?? "";
  const municipalityName =
    municipalities.find((m) => m.code === municipalityCode)?.name ?? "";

  const psgcBreadcrumb = [municipalityName, provinceName, regionName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="relative z-20 mb-2 flex rounded-lg border border-aeris-border/60 bg-aeris-bg/40 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("location")}
          className={clsx(
            "hud-text flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors",
            activeTab === "location"
              ? "bg-aeris-accent/10 text-aeris-accent border border-aeris-accent/30"
              : "text-aeris-muted hover:text-aeris-text",
          )}
          aria-pressed={activeTab === "location"}
        >
          Location Info
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("agent")}
          className={clsx(
            "hud-text flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors",
            activeTab === "agent"
              ? "bg-aeris-accent/10 text-aeris-accent border border-aeris-accent/30"
              : "text-aeris-muted hover:text-aeris-text",
          )}
          aria-pressed={activeTab === "agent"}
        >
          AGENT AERIS
        </button>
      </div>

      {activeTab === "location" && (
        <div className="relative z-10 flex flex-col gap-2.5 flex-1 min-h-0 pb-[28rem] sm:pb-[30rem] md:pb-[36rem]">
      {/* Header with gradient accent */}
      <div className="px-1">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <svg
                className="shrink-0 text-aeris-accent"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M12 1C6.48 1 2 5.48 2 11s4.48 10 10 10 10-4.48 10-10S17.52 1 12 1z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <circle cx="12" cy="11" r="3" fill="currentColor" />
              </svg>
              <div className="hud-text text-aeris-text text-sm tracking-tight">
                Location Info
              </div>
            </div>
            <div className="text-[10px] text-aeris-muted ml-0.5">
              PSA PSGC · Barangay Census Data
            </div>
          </div>
          <div className="shrink-0">
            <Pill tone="accent">PSA</Pill>
          </div>
        </div>
      </div>

      {/* Search Section */}
      <div className="relative px-1">
        <div
          className={clsx(
            "group relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200",
            isFocused || query
              ? "bg-aeris-accent/5 border border-aeris-accent/40 shadow-sm"
              : "bg-aeris-bg/40 border border-aeris-border/60 hover:border-aeris-border",
          )}
        >
          {/* Search icon with animation */}
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
            <circle
              cx="6.5"
              cy="6.5"
              r="5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M10.5 10.5L14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
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

          {/* Clear / spinner */}
          <div className="shrink-0 flex items-center gap-1.5">
            {searching && (
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse"></span>
                <span
                  className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse"
                  style={{ animationDelay: "0.15s" }}
                ></span>
                <span
                  className="w-1.5 h-1.5 bg-aeris-accent/60 rounded-full animate-pulse"
                  style={{ animationDelay: "0.3s" }}
                ></span>
              </span>
            )}
            {query && !searching && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSuggestions([]);
                  setDropdownOpen(false);
                  setSelected(null);
                  inputRef.current?.focus();
                }}
                className="text-aeris-muted/60 hover:text-aeris-text transition-colors leading-none p-0.5"
                aria-label="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 2L10 10M10 2L2 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Suggestions dropdown with smooth animation */}
        {dropdownOpen && suggestions.length > 0 && (
          <ul
            ref={listRef}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 bg-aeris-surface border border-aeris-border/80 rounded-lg overflow-hidden shadow-xl max-h-56 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
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

      {/* Browse section */}
      <div className="relative px-1">
        <button
          type="button"
          onClick={() => setBrowseOpen((v) => !v)}
          className={clsx(
            "w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200",
            browseOpen
              ? "bg-aeris-accent/8 border border-aeris-accent/30"
              : "bg-aeris-bg/30 border border-aeris-border/40 hover:border-aeris-border/60",
          )}
        >
          <span className="text-[11px] font-mono text-aeris-muted uppercase tracking-wide font-semibold">
            + Browse by Region
          </span>
          <svg
            className={clsx(
              "text-aeris-muted/60 transition-transform duration-300 ease-out",
              browseOpen ? "rotate-180" : "",
            )}
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M2 4L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {browseOpen && (
          <div className="mt-1.5 px-3 py-2.5 rounded-lg border border-aeris-border/40 bg-aeris-bg/20 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
            <SelectDropdown
              label="Region"
              options={regions.map((r) => ({
                ...r,
                name: `${REGION_ABBREV[r.code] ?? r.regionName} · ${r.name}`,
              }))}
              value={regionCode}
              onChange={handleRegionChange}
            />
            {regionCode && (
              <SelectDropdown
                label="Province"
                options={provinces}
                value={provinceCode}
                onChange={handleProvinceChange}
                loading={loadingStep === "province"}
              />
            )}
            {provinceCode && (
              <SelectDropdown
                label="City / Municipality"
                options={municipalities}
                value={municipalityCode}
                onChange={handleMunicipalityChange}
                loading={loadingStep === "municipality"}
              />
            )}
            {municipalityCode && (
              <SelectDropdown
                label="Barangay"
                options={barangays}
                value={barangayCode}
                onChange={handleBarangayChange}
                loading={loadingStep === "barangay"}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Location details ────────────────────────────────────────── */}
      {(selected || selectedPsgc) && (
        <div className="flex-1 min-h-0 overflow-y-auto px-1">
          <div className="rounded-lg border border-aeris-border/50 bg-gradient-to-br from-aeris-accent/5 to-aeris-elev/30 p-3 space-y-2.5 animate-in fade-in scale-95 duration-200 origin-top">
            {/* Header with gradient top */}
            <div className="relative -m-3 mb-2 px-3 py-2.5 -mx-3 border-b border-aeris-border/20 bg-aeris-accent/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-aeris-text leading-tight">
                    {selectedPsgc?.name ?? selected?.name}
                  </div>
                  <div className="text-[10px] text-aeris-muted font-mono mt-1 truncate">
                    {selectedPsgc
                      ? psgcBreadcrumb
                      : selected?.breadcrumb || selected?.displayName.split(",").slice(1, 3).join(",")}
                  </div>
                </div>
                <div className="shrink-0">
                  {selected && (
                    <span className="inline-flex text-[9px] font-mono uppercase tracking-widest text-aeris-accent border border-aeris-accent/40 rounded-full px-2 py-1 bg-aeris-accent/5 font-semibold">
                      {selected.type}
                    </span>
                  )}
                  {selectedPsgc && (
                    <span className="inline-flex text-[9px] font-mono uppercase tracking-widest text-aeris-accent border border-aeris-accent/40 rounded-full px-2 py-1 bg-aeris-accent/5 font-semibold">
                      Barangay
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="space-y-1">
              {selectedPsgc && (
                <>
                  <StatRow
                    label="PSGC Code"
                    value={
                      selectedPsgc.psgc10DigitCode ?? selectedPsgc.code
                    }
                  />
                  <StatRow
                    label="Urban / Rural"
                    value={selectedPsgc.urbanRural}
                  />
                  <StatRow
                    label="Population"
                    value={
                      selectedPsgc.population !== undefined
                        ? selectedPsgc.population.toLocaleString()
                        : undefined
                    }
                  />
                  <StatRow
                    label="Island Group"
                    value={selectedPsgc.islandGroup}
                  />
                  {selectedPsgc.oldName && (
                    <StatRow
                      label="Former Name"
                      value={selectedPsgc.oldName}
                    />
                  )}
                </>
              )}

              {selected && !selectedPsgc && (
                <>
                  <StatRow
                    label="Coordinates"
                    value={`${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`}
                  />
                  <StatRow label="Type" value={selected.type} />
                </>
              )}
            </div>

            {/* Fly-to button */}
            {map && selected && (
              <button
                type="button"
                onClick={() => flyTo(selected.lat, selected.lon)}
                className="w-full mt-1 py-2 text-[11px] font-mono font-semibold uppercase tracking-wider text-aeris-accent bg-aeris-accent/10 border border-aeris-accent/40 rounded-md hover:bg-aeris-accent/15 hover:border-aeris-accent/60 transition-all duration-200 active:scale-95"
              >
                ⚡ Re-centre Map
              </button>
            )}
          </div>

          <div className="mt-2 px-1 text-[9px] text-aeris-muted/50 font-mono">
            {selectedPsgc
              ? "Source: PSA PSGC · psgc.gitlab.io · 2020 Census"
              : "Location: © OpenStreetMap contributors (Nominatim)"}
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!selected && !selectedPsgc && !query && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-3">
          <div className="w-12 h-12 rounded-lg bg-aeris-accent/5 border border-aeris-accent/20 flex items-center justify-center">
            <svg
              className="text-aeris-accent/40"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              <path
                d="M12 2v2M12 20v2M22 12h-2M4 12H2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="space-y-0.5">
            <p className="text-[12px] font-semibold text-aeris-text">
              Explore the Philippines
            </p>
            <p className="text-[10px] text-aeris-muted/60 leading-relaxed">
              Search any barangay, city, or municipality to view census data and jump to the map
            </p>
          </div>
        </div>
      )}
      </div>
      )}

      {activeTab === "agent" && (
        <AgentAerisPanel
          selectedLocation={
            selected
              ? {
                  name: selected.name,
                  breadcrumb: selected.breadcrumb,
                  lat: selected.lat,
                  lon: selected.lon,
                  type: selected.type,
                }
              : selectedPsgc
                ? {
                    name: selectedPsgc.name,
                    breadcrumb: psgcBreadcrumb,
                    type: "Barangay",
                    psgcCode:
                      selectedPsgc.psgc10DigitCode ?? selectedPsgc.code,
                    population: selectedPsgc.population,
                  }
                : null
          }
          isActive={activeTab === "agent"}
        />
      )}

      {activeTab === "location" && (
        <div className="pointer-events-none absolute bottom-0 right-0 z-0 select-none">
          <Image
            src="/assets/AERIS_char.svg"
            alt=""
            width={850}
            height={1150}
            className="h-auto w-[320px] sm:w-[380px] md:w-[420px] object-contain opacity-90 drop-shadow-[0_8px_28px_rgba(15,23,42,0.2)]"
            loading="lazy"
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

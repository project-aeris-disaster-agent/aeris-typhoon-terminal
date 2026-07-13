/**
 * PAGASA Tropical Cyclone Bulletin (TCB) index.
 *
 * PAGASA publishes no machine-readable RSS/API for active in-PAR tropical
 * cyclone bulletins — the advertised Joomla "feed" URLs return the full HTML
 * homepage, and the bulletins themselves are published as PDFs on
 * pubfiles.pagasa.dost.gov.ph with no listing endpoint.
 *
 * The community `pagasa-parser` project (public-domain, volunteer-run) scrapes
 * PAGASA's bulletin page and exposes a small JSON index of the currently
 * available bulletins. We consume that index for cyclone name, bulletin
 * number, "final" flag, and the official PAGASA PDF link. We do NOT parse the
 * PDF contents — wind signals come from the PDFs, which we intentionally leave
 * to the source of truth.
 *
 * The parser index often retains dissipated cyclones as non-final. We gate
 * that against the official Severe Weather Bulletin page: when PAGASA says
 * there is no active TC in PAR, we clear the active index and surface the
 * single latest archive TCB PDF from that page. Storm-watch cycle history
 * (`filterStaleBulletins`) remains a backup when the SWB probe fails.
 *
 * Upstream shape (https://pagasa.chlod.net/api/v1/bulletin/list):
 *   { "error": false, "bulletins": [
 *       { "name": "ester", "count": 1, "final": false,
 *         "file": "TCB#1_ester.pdf",
 *         "link": "https://pubfiles.pagasa.dost.gov.ph/.../TCB%231_ester.pdf" }
 *   ], "age": 0 }
 *
 * Defensive throughout: upstream failures fall back to the last healthy snapshot
 * when available. Wrapped in a circuit breaker with adaptive in-process TTL
 * (shorter during active cyclones).
 */

import { withBreaker } from "@/lib/circuit-breaker";

const PAGASA_BULLETIN_LIST_URL = "https://pagasa.chlod.net/api/v1/bulletin/list";
const PAGASA_SWB_URL =
  "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin";
const PROVIDER_NOTE =
  "Index via pagasa-parser (pagasa.chlod.net); quiet-PAR + latest archive via official PAGASA SWB page; bulletins are PAGASA public-domain PDFs.";
const CACHE_TTL_QUIET_MS = 15 * 60 * 1000;
const CACHE_TTL_ACTIVE_MS = 3 * 60 * 1000;
const ERROR_BACKOFF_MS = 60 * 1000;
const STALE_SERVE_MS = 20 * 60 * 1000;
const SWB_CACHE_TTL_MS = 5 * 60 * 1000;
const SWB_QUIET_RE =
  /No\s+Active\s+Tropical\s+Cyclone\s+within\s+the\s+Philippine\s+Area\s+of\s+Responsibility/i;
const SWB_ARCHIVE_LINK_RE =
  /href="(https:\/\/pubfiles\.pagasa\.dost\.gov\.ph[^"]*TCB(?:%23|#)(\d+)_([a-z0-9_-]+)\.pdf)"/gi;

export type PagasaBulletin = {
  /** Cyclone name, title-cased (e.g. "Ester"). */
  name: string;
  /** Latest bulletin sequence number for this cyclone. */
  number: number;
  /** True when the latest bulletin is PAGASA's final bulletin for the system. */
  final: boolean;
  /** Source PDF filename, e.g. "TCB#7_ester.pdf". */
  file: string;
  /** Official PAGASA PDF URL. */
  pdfUrl: string;
  /**
   * True when this is the latest archive PDF from the SWB page (shown only
   * while PAR is quiet — not an active tropical cyclone bulletin).
   */
  archive?: boolean;
};

export type PagasaBulletins = {
  source: "pagasa-bulletins";
  via: string;
  fetchedAt: string;
  /** Seconds since pagasa-parser last scraped PAGASA (upstream `age` field). */
  indexAgeSeconds?: number | null;
  /** True when serving a cached snapshot after a live fetch failure. */
  stale?: boolean;
  /** Human-readable note when data is degraded or cached. */
  warning?: string;
  /**
   * True when the official PAGASA SWB page reports no active TC in PAR.
   * Active parser leftovers are cleared; `bulletins` may hold the latest
   * archive SWB PDF instead.
   */
  quiet?: boolean;
  /** Any cyclone whose latest bulletin is not yet final (excludes archive). */
  hasActive: boolean;
  /** Latest bulletin per cyclone, active (non-final) first, then by name. */
  bulletins: PagasaBulletin[];
};

/** Result of one official SWB page fetch. `null` fields mean probe failed. */
export type SwbPageProbe = {
  quiet: boolean;
  latestArchive: PagasaBulletin | null;
};

type UpstreamBulletin = {
  name?: unknown;
  count?: unknown;
  final?: unknown;
  file?: unknown;
  link?: unknown;
};

type UpstreamResponse = {
  error?: unknown;
  bulletins?: unknown;
  age?: unknown;
};

export type FetchPagasaBulletinsOptions = {
  bypassCache?: boolean;
};

type CacheEntry = {
  at: number;
  value: PagasaBulletins | null;
  isError: boolean;
};

let cache: CacheEntry | null = null;
let lastHealthy: { at: number; value: PagasaBulletins } | null = null;
let inFlight: Promise<PagasaBulletins | null> | null = null;
let swbProbeCache: { at: number; value: SwbPageProbe | null } | null = null;
let swbInFlight: Promise<SwbPageProbe | null> | null = null;

function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseIndexAge(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null || n < 0) return null;
  return Math.round(n);
}

function cacheTtlMs(value: PagasaBulletins | null): number {
  if (value?.hasActive) return CACHE_TTL_ACTIVE_MS;
  // Quiet PAR can flip quickly when a new system enters — refresh sooner.
  if (value?.quiet) return SWB_CACHE_TTL_MS;
  return CACHE_TTL_QUIET_MS;
}

function upstreamRevalidateSeconds(value: PagasaBulletins | null | undefined): number {
  if (value?.hasActive) return 180;
  return 900;
}

function staleSnapshotWarning(): string {
  return "Live bulletin index unavailable; showing most recent successful snapshot.";
}

function buildStalePayload(base: PagasaBulletins): PagasaBulletins {
  return {
    ...base,
    stale: true,
    warning: staleSnapshotWarning(),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * True when official PAGASA SWB HTML states there is no active TC in PAR.
 * Exported for unit tests.
 */
export function isSwbQuietHtml(html: string): boolean {
  return SWB_QUIET_RE.test(html);
}

/**
 * Pick the highest-numbered TCB PDF linked on the SWB page (archive section).
 * Exported for unit tests.
 */
export function extractLatestArchiveBulletin(
  html: string,
): PagasaBulletin | null {
  let best: PagasaBulletin | null = null;
  for (const match of html.matchAll(SWB_ARCHIVE_LINK_RE)) {
    const pdfUrl = match[1];
    const number = Number(match[2]);
    const slug = match[3];
    if (!pdfUrl || !Number.isFinite(number) || !slug) continue;
    if (best && number <= best.number) continue;
    best = {
      name: titleCase(slug.replace(/_/g, " ")),
      number,
      final: true,
      archive: true,
      file: `TCB#${number}_${slug}.pdf`,
      pdfUrl,
    };
  }
  return best;
}

/** Parse quiet banner + latest archive PDF from one SWB HTML response. */
export function parseSwbPage(html: string): SwbPageProbe {
  const quiet = isSwbQuietHtml(html);
  return {
    quiet,
    latestArchive: quiet ? extractLatestArchiveBulletin(html) : null,
  };
}

/**
 * Probe the official Severe Weather Bulletin page.
 * Returns probe result, or null when the page could not be fetched.
 */
export async function probePagasaSwbPage(
  bypassCache = false,
): Promise<SwbPageProbe | null> {
  const now = Date.now();
  if (!bypassCache && swbProbeCache && now - swbProbeCache.at < SWB_CACHE_TTL_MS) {
    return swbProbeCache.value;
  }
  if (swbInFlight) return swbInFlight;

  swbInFlight = (async () => {
    try {
      const probe = await withBreaker(
        "pagasa-swb",
        async () => {
          const res = await fetch(PAGASA_SWB_URL, {
            headers: {
              "user-agent":
                "AERIS-Dashboard/1.0 (+disaster-resilience; contact via repo)",
              accept: "text/html,application/xhtml+xml",
            },
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`PAGASA SWB ${res.status}`);
          return parseSwbPage(await res.text());
        },
        { cooldownMs: 300_000, timeoutMs: 8_000 },
      );
      swbProbeCache = { at: Date.now(), value: probe };
      return probe;
    } catch {
      swbProbeCache = { at: Date.now(), value: null };
      return null;
    } finally {
      swbInFlight = null;
    }
  })();

  return swbInFlight;
}

async function applySwbQuietGate(
  data: PagasaBulletins,
  bypassCache: boolean,
): Promise<PagasaBulletins> {
  const probe = await probePagasaSwbPage(bypassCache);
  if (probe?.quiet) {
    return {
      ...data,
      bulletins: probe.latestArchive ? [probe.latestArchive] : [],
      hasActive: false,
      quiet: true,
      // Quiet PAR is authoritative — drop stale-snapshot noise.
      stale: undefined,
      warning: undefined,
    };
  }
  return {
    ...data,
    quiet: probe ? false : undefined,
  };
}

/**
 * Reduce the raw bulletin list (one entry per issued bulletin) to the latest
 * bulletin per cyclone. Pure + exported so it can be unit-tested without a fetch.
 */
export function reduceBulletins(payload: unknown): PagasaBulletins | null {
  const body = payload as UpstreamResponse | null;
  if (!body || body.error === true || !Array.isArray(body.bulletins)) {
    return null;
  }

  const latest = new Map<string, PagasaBulletin>();
  for (const raw of body.bulletins as UpstreamBulletin[]) {
    const rawName = typeof raw?.name === "string" ? raw.name.trim() : "";
    const number = toNumber(raw?.count);
    const pdfUrl = typeof raw?.link === "string" ? raw.link.trim() : "";
    if (!rawName || number === null || !pdfUrl) continue;

    const entry: PagasaBulletin = {
      name: titleCase(rawName),
      number,
      final: raw?.final === true,
      file: typeof raw?.file === "string" ? raw.file : "",
      pdfUrl,
    };

    const key = rawName.toLowerCase();
    const existing = latest.get(key);
    if (!existing || entry.number >= existing.number) {
      latest.set(key, entry);
    }
  }

  const bulletins = [...latest.values()].sort((a, b) => {
    if (a.final !== b.final) return a.final ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return {
    source: "pagasa-bulletins",
    via: PROVIDER_NOTE,
    fetchedAt: new Date().toISOString(),
    indexAgeSeconds: parseIndexAge(body.age),
    hasActive: bulletins.some((b) => !b.final),
    bulletins,
  };
}

async function fetchUpstream(
  bypassCache: boolean,
  hint: PagasaBulletins | null | undefined,
): Promise<PagasaBulletins | null> {
  return withBreaker(
    "pagasa-bulletins",
    async () => {
      const res = await fetch(PAGASA_BULLETIN_LIST_URL, {
        headers: {
          "user-agent":
            "AERIS-Dashboard/1.0 (+disaster-resilience; contact via repo)",
          accept: "application/json",
        },
        ...(bypassCache
          ? { cache: "no-store" as RequestCache }
          : { next: { revalidate: upstreamRevalidateSeconds(hint) } }),
      });
      if (!res.ok) throw new Error(`PAGASA bulletins ${res.status}`);
      return reduceBulletins(await res.json());
    },
    { cooldownMs: 300_000, timeoutMs: 8_000 },
  );
}

export async function fetchPagasaBulletins(
  options?: FetchPagasaBulletinsOptions,
): Promise<PagasaBulletins | null> {
  const bypass = options?.bypassCache === true;
  const now = Date.now();

  if (!bypass && cache) {
    const ttl = cache.isError ? ERROR_BACKOFF_MS : cacheTtlMs(cache.value);
    if (now - cache.at < ttl) {
      return cache.value;
    }
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const hint = cache?.value ?? lastHealthy?.value ?? null;
      const value = await fetchUpstream(bypass, hint);
      if (value) {
        const gated = await applySwbQuietGate(value, bypass);
        lastHealthy = { at: Date.now(), value: gated };
        cache = { at: Date.now(), value: gated, isError: false };
        return gated;
      }

      if (lastHealthy && Date.now() - lastHealthy.at < STALE_SERVE_MS) {
        const staleValue = await applySwbQuietGate(
          buildStalePayload(lastHealthy.value),
          bypass,
        );
        cache = { at: Date.now(), value: staleValue, isError: true };
        return staleValue;
      }

      cache = { at: Date.now(), value: null, isError: true };
      return null;
    } catch {
      if (lastHealthy && Date.now() - lastHealthy.at < STALE_SERVE_MS) {
        const staleValue = await applySwbQuietGate(
          buildStalePayload(lastHealthy.value),
          bypass,
        );
        cache = { at: Date.now(), value: staleValue, isError: true };
        return staleValue;
      }

      cache = { at: Date.now(), value: null, isError: true };
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test-only: reset the in-memory cache between unit tests. */
export function __resetPagasaBulletinsCache() {
  cache = null;
  lastHealthy = null;
  inFlight = null;
  swbProbeCache = null;
  swbInFlight = null;
}

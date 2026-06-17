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
 * available bulletins. We consume only that index here: cyclone name, bulletin
 * number, "final" flag, and the official PAGASA PDF link. We do NOT parse the
 * PDF contents — wind signals come from the PDFs, which we intentionally leave
 * to the source of truth.
 *
 * Upstream shape (https://pagasa.chlod.net/api/v1/bulletin/list):
 *   { "error": false, "bulletins": [
 *       { "name": "ester", "count": 1, "final": false,
 *         "file": "TCB#1_ester.pdf",
 *         "link": "https://pubfiles.pagasa.dost.gov.ph/.../TCB%231_ester.pdf" }
 *   ], "age": 0 }
 *
 * Defensive throughout: any failure or shape drift yields null and the caller
 * treats bulletins as "not loaded" rather than breaking the request. Wrapped in
 * a circuit breaker and cached in-process for 15 minutes.
 */

import { withBreaker } from "@/lib/circuit-breaker";

const PAGASA_BULLETIN_LIST_URL = "https://pagasa.chlod.net/api/v1/bulletin/list";
const PROVIDER_NOTE =
  "Index via pagasa-parser (pagasa.chlod.net); bulletins are PAGASA public-domain PDFs.";
const CACHE_TTL_MS = 15 * 60 * 1000;

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
};

export type PagasaBulletins = {
  source: "pagasa-bulletins";
  via: string;
  fetchedAt: string;
  /** Any cyclone whose latest bulletin is not yet final. */
  hasActive: boolean;
  /** Latest bulletin per cyclone, active (non-final) first, then by name. */
  bulletins: PagasaBulletin[];
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
};

let cache: { at: number; value: PagasaBulletins | null } | null = null;
let inFlight: Promise<PagasaBulletins | null> | null = null;

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
    hasActive: bulletins.some((b) => !b.final),
    bulletins,
  };
}

export async function fetchPagasaBulletins(): Promise<PagasaBulletins | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await withBreaker(
        "pagasa-bulletins",
        async () => {
          const res = await fetch(PAGASA_BULLETIN_LIST_URL, {
            headers: {
              "user-agent":
                "AERIS-Dashboard/1.0 (+disaster-resilience; contact via repo)",
              accept: "application/json",
            },
            next: { revalidate: 900 },
          });
          if (!res.ok) throw new Error(`PAGASA bulletins ${res.status}`);
          return reduceBulletins(await res.json());
        },
        { cooldownMs: 300_000, timeoutMs: 8_000 },
      );
      cache = { at: Date.now(), value };
      return value;
    } catch {
      cache = { at: Date.now(), value: null };
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
  inFlight = null;
}

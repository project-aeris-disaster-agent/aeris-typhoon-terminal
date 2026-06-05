/**
 * Boot-time preflight system checks.
 *
 * Probes every overlay/feature data source the dashboard depends on (report
 * pings, radar, satellite, flood projections, buildings, wind, typhoon tracks,
 * water levels, live feeds, core system) so the loading screen can verify the
 * stack is wired up before revealing the terminal.
 *
 * Each check resolves to a status — `ok` (green), `warn` (degraded but usable)
 * or `fail` (data source unreachable). The runner never throws and always
 * settles within `CHECK_TIMEOUT_MS`, so it can be safely gated behind the boot
 * screen without ever hanging the UI.
 */

import { waitForOverlayReady } from "@/lib/overlay-ready";

export type CheckStatus = "pending" | "running" | "ok" | "warn" | "fail";

export type PreflightResult = {
  id: string;
  /** Short human label shown on the boot checklist. */
  label: string;
  status: CheckStatus;
  detail?: string;
};

type ProbeOutcome = { status: "ok" | "warn" | "fail"; detail?: string };

type CheckDef = {
  id: string;
  label: string;
  /**
   * `gate` checks block the boot screen on the overlay genuinely rendering on
   * the map; the terminal must not appear until they (and the map) are ready.
   * Informational checks just surface data-source health.
   */
  gate?: boolean;
  /** Per-check timeout override (ms). Defaults to `CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<ProbeOutcome>;
};

/** Hard ceiling per informational check — keeps the sweep under the failsafe. */
const CHECK_TIMEOUT_MS = 7_000;
/** Render-gated overlays get longer — tiles/feed must actually paint. */
const GATE_TIMEOUT_MS = 11_000;

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON or empty body — leave as null */
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Generic JSON probe. `validate` may downgrade a 2xx response to `warn` (e.g.
 * endpoint reachable but returned no usable data). Non-2xx → `fail`, with an
 * optional soft `warnOnFail` for non-critical overlays.
 */
function jsonProbe(
  url: string,
  opts: {
    validate?: (data: unknown) => ProbeOutcome | null;
    warnOnFail?: boolean;
  } = {},
): (signal: AbortSignal) => Promise<ProbeOutcome> {
  return async (signal) => {
    try {
      const { ok, status, data } = await fetchJson(url, signal);
      if (!ok) {
        return {
          status: opts.warnOnFail ? "warn" : "fail",
          detail: `HTTP ${status}`,
        };
      }
      if (opts.validate) {
        const verdict = opts.validate(data);
        if (verdict) return verdict;
      }
      return { status: "ok" };
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      return {
        status: opts.warnOnFail ? "warn" : "fail",
        detail: aborted ? "timeout" : "unreachable",
      };
    }
  };
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

const CHECKS: CheckDef[] = [
  {
    id: "system",
    label: "Core system",
    run: jsonProbe("/api/health", {
      validate: (data) => {
        const rec = asRecord(data);
        if (rec && rec.ok === false) {
          return { status: "warn", detail: "degraded config" };
        }
        return null;
      },
      warnOnFail: true,
    }),
  },
  {
    id: "reports",
    label: "Report pings",
    gate: true,
    timeoutMs: GATE_TIMEOUT_MS,
    // Waits for the report-pings layer to actually render on the map (feed
    // reachable + layer added), not just for /api/reports to respond.
    run: (signal) => waitForOverlayReady("reports", signal),
  },
  {
    id: "radar",
    label: "Weather radar",
    gate: true,
    timeoutMs: GATE_TIMEOUT_MS,
    // Waits for the radar overlay to actually appear on the map (layer added +
    // first frame's tiles loaded), not just for the RainViewer index.
    run: (signal) => waitForOverlayReady("radar", signal),
  },
  {
    id: "satellite",
    label: "Satellite imagery",
    gate: true,
    timeoutMs: GATE_TIMEOUT_MS,
    // Waits for the satellite feed to be confirmed available at boot (frames
    // prefetched by the live-weather overlay), not just for the index endpoint.
    run: (signal) => waitForOverlayReady("satellite", signal),
  },
  {
    id: "flood",
    label: "Flood projections",
    run: jsonProbe("/flood-hazard/index.json", {
      validate: (data) => {
        if (!data || (Array.isArray(data) && data.length === 0)) {
          return { status: "warn", detail: "no packs" };
        }
        return null;
      },
    }),
  },
  {
    id: "buildings",
    label: "Buildings & facilities",
    run: jsonProbe("/osm-context/ncr.json", { warnOnFail: true }),
  },
  {
    id: "wind",
    label: "Wind field",
    run: jsonProbe("/api/wind-field", { warnOnFail: true }),
  },
  {
    id: "typhoon",
    label: "Typhoon tracks",
    run: jsonProbe("/api/jtwc", { warnOnFail: true }),
  },
  {
    id: "water",
    label: "Water levels",
    run: jsonProbe("/api/pagasa-water-levels", { warnOnFail: true }),
  },
  {
    id: "feeds",
    label: "Live feeds",
    run: jsonProbe("/api/youtube-feed", { warnOnFail: true }),
  },
];

/** Initial pending snapshot — render this before any check has started. */
export function initialPreflightResults(): PreflightResult[] {
  return CHECKS.map((c) => ({ id: c.id, label: c.label, status: "pending" }));
}

/**
 * Runs every check in parallel, emitting an updated snapshot via `onUpdate`
 * each time a check starts and settles. Resolves once all checks have settled.
 * Never rejects.
 */
export function runPreflightChecks(
  onUpdate: (results: PreflightResult[]) => void,
): Promise<PreflightResult[]> {
  const results: PreflightResult[] = initialPreflightResults();
  const emit = () => onUpdate(results.map((r) => ({ ...r })));

  const tasks = CHECKS.map(async (check, index) => {
    results[index] = { ...results[index], status: "running" };
    emit();

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      check.timeoutMs ?? CHECK_TIMEOUT_MS,
    );
    let outcome: ProbeOutcome;
    try {
      outcome = await check.run(controller.signal);
    } catch {
      outcome = { status: "fail", detail: "error" };
    } finally {
      clearTimeout(timer);
    }

    results[index] = { ...results[index], ...outcome };
    emit();
  });

  return Promise.all(tasks).then(() => results.map((r) => ({ ...r })));
}

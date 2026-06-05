/**
 * Cross-module registry for "overlay actually rendered" signals.
 *
 * Some boot-time checks must wait for a map overlay to genuinely appear (its
 * layer added + its data/tiles loaded), not merely for the backing API to
 * respond. The producing services (report pings, radar) call
 * `markOverlayReady` once the overlay is confirmed on the map; the boot screen
 * preflight consumes it via `waitForOverlayReady`.
 *
 * A module-level store (singleton per page load) avoids the event race where a
 * "ready" signal fires before the boot screen has attached a listener: the
 * first signal wins and is replayed to any later waiter.
 */

export type OverlayId = "reports" | "radar" | "satellite";
export type OverlayReadyStatus = "ok" | "warn" | "fail";
export type OverlayReadyResult = { status: OverlayReadyStatus; detail?: string };

const settled = new Map<OverlayId, OverlayReadyResult>();
const waiters = new Map<OverlayId, Array<(r: OverlayReadyResult) => void>>();

/** Record that an overlay has rendered (or failed to). First signal wins. */
export function markOverlayReady(id: OverlayId, result: OverlayReadyResult) {
  if (settled.has(id)) return;
  settled.set(id, result);
  const list = waiters.get(id);
  if (list) {
    waiters.delete(id);
    for (const fn of list) fn(result);
  }
}

export function getOverlayReady(id: OverlayId): OverlayReadyResult | null {
  return settled.get(id) ?? null;
}

/**
 * Resolves when the overlay has signalled (or immediately if it already has).
 * If `signal` aborts first, resolves to a `fail` outcome so the caller never
 * hangs. Never rejects.
 */
export function waitForOverlayReady(
  id: OverlayId,
  signal?: AbortSignal,
): Promise<OverlayReadyResult> {
  const existing = settled.get(id);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      const cur = waiters.get(id);
      if (cur) waiters.set(id, cur.filter((f) => f !== onResolve));
    };
    const onResolve = (r: OverlayReadyResult) => {
      cleanup();
      resolve(r);
    };
    const onAbort = () => {
      cleanup();
      resolve({ status: "fail", detail: "not rendered" });
    };

    const list = waiters.get(id) ?? [];
    list.push(onResolve);
    waiters.set(id, list);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Test/HMR helper — clears all recorded signals and pending waiters. */
export function resetOverlayReady() {
  settled.clear();
  waiters.clear();
}

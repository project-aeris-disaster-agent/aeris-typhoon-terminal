export type BlinkPhase = "idle" | "closing" | "opening";

export type BlinkState = {
  phase: BlinkPhase;
  phaseStart: number;
  nextBlinkAt: number;
};

const CLOSE_SEC = 0.1;
const OPEN_SEC = 0.1;
const MIN_IDLE_SEC = 2.5;
const IDLE_SPREAD_SEC = 3;

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export function createBlinkState(elapsed: number): BlinkState {
  return {
    phase: "idle",
    phaseStart: elapsed,
    nextBlinkAt: elapsed + MIN_IDLE_SEC + Math.random() * IDLE_SPREAD_SEC,
  };
}

function scheduleNextBlink(state: BlinkState, elapsed: number): void {
  state.phase = "idle";
  state.nextBlinkAt = elapsed + MIN_IDLE_SEC + Math.random() * IDLE_SPREAD_SEC;
}

/**
 * Returns blink blend weight 0–1 for the current frame.
 * Suppressed while the avatar is speaking so lip-sync stays readable.
 */
export function updateBlinkWeight(
  elapsed: number,
  state: BlinkState,
  speaking: boolean,
): number {
  if (speaking) {
    if (state.phase !== "idle") {
      scheduleNextBlink(state, elapsed);
    }
    return 0;
  }

  if (state.phase === "idle") {
    if (elapsed < state.nextBlinkAt) return 0;
    state.phase = "closing";
    state.phaseStart = elapsed;
  }

  if (state.phase === "closing") {
    const t = Math.min(1, (elapsed - state.phaseStart) / CLOSE_SEC);
    if (t >= 1) {
      state.phase = "opening";
      state.phaseStart = elapsed;
      return 1;
    }
    return easeInQuad(t);
  }

  const t = Math.min(1, (elapsed - state.phaseStart) / OPEN_SEC);
  if (t >= 1) {
    scheduleNextBlink(state, elapsed);
    return 0;
  }
  return 1 - easeOutQuad(t);
}

"use client";

/**
 * First-run tutorial: A.E.R.I.S. and Disaster Minds (from bagyo-game) walk a
 * new visitor through the dashboard in six short steps, in English, Tagalog
 * or Bisaya.
 *
 * Shown once per browser, right after the boot screen. The header's "?"
 * button replays it. Each step rings the part of the dashboard it talks about
 * (`data-tour` attributes); steps whose target isn't on screen are left out.
 */

import { clsx } from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Segmented } from "@/components/ui/Kit";
import {
  GUIDE_BIOS,
  GUIDE_SPRITES,
  LANG_LABELS,
  TUTORIAL_LANGS,
  TUTORIAL_STEPS,
  TUTORIAL_UI,
  detectTutorialLang,
  type GuideId,
  type TutorialLang,
  type TutorialStep,
} from "@/lib/tutorial/content";
import {
  BOOT_DONE_EVENT,
  TUTORIAL_OPEN_EVENT,
  hasSeenTutorial,
  isBootDone,
  markTutorialSeen,
  readTutorialLang,
  saveTutorialLang,
} from "@/lib/tutorial/storage";

const RING_PAD = 6;
const TALK_MS = 1400;
const MOUTH_MS = 150;

type Rect = { top: number; left: number; width: number; height: number };

function targetElement(step: TutorialStep): HTMLElement | null {
  if (!step.target) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

function visibleRect(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) {
    return null;
  }
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Steps that make sense on this screen right now. */
function stepsForScreen(): TutorialStep[] {
  return TUTORIAL_STEPS.filter((s) => !s.target || visibleRect(targetElement(s)) !== null);
}

/** Neutral, so the dim reads on both the light and the navy dark theme. */
const DIM = "rgb(0 0 0 / 0.55)";

/**
 * The highlight: an accent ring plus a huge spread shadow that dims everything
 * else. One `box-shadow` for both (a Tailwind `ring-*` is also a box-shadow,
 * and an inline shadow would silently replace it). Kept inside the viewport
 * so a full-bleed target like the map still shows all four edges.
 */
function ringBox(rect: Rect): CSSProperties {
  const edge = 4;
  const left = Math.max(edge, rect.left - RING_PAD);
  const top = Math.max(edge, rect.top - RING_PAD);
  const right = Math.min(window.innerWidth - edge, rect.left + rect.width + RING_PAD);
  const bottom = Math.min(window.innerHeight - edge, rect.top + rect.height + RING_PAD);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    boxShadow: `0 0 0 3px rgb(var(--aeris-accent)), 0 0 0 9999px ${DIM}`,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function GuidePortrait({ who, talking }: { who: GuideId; talking: boolean }) {
  const sprite = GUIDE_SPRITES[who];
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (!talking) {
      setMouthOpen(false);
      return;
    }
    const id = window.setInterval(() => setMouthOpen((v) => !v), MOUTH_MS);
    return () => window.clearInterval(id);
  }, [talking]);

  const frame = mouthOpen ? sprite.talk : sprite.rest;
  return (
    <div
      role="img"
      aria-label={GUIDE_BIOS[who].name}
      className="h-full shrink-0 bg-no-repeat"
      style={{
        aspectRatio: `${sprite.frameW} / ${sprite.frameH}`,
        backgroundImage: `url(${sprite.src})`,
        backgroundSize: `${sprite.frameCount * 100}% 100%`,
        backgroundPosition: `${(frame / (sprite.frameCount - 1)) * 100}% 0%`,
      }}
    />
  );
}

export function FirstRunTutorial() {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<TutorialStep[]>(TUTORIAL_STEPS);
  const [index, setIndex] = useState(0);
  const [lang, setLang] = useState<TutorialLang>("en");
  const [rect, setRect] = useState<Rect | null>(null);
  const [talking, setTalking] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const start = useCallback(() => {
    setLang(readTutorialLang() ?? detectTutorialLang(navigator.languages));
    setSteps(stepsForScreen());
    setIndex(0);
    setOpen(true);
  }, []);

  const finish = useCallback(() => {
    markTutorialSeen();
    setOpen(false);
  }, []);

  // First visit: open once the boot screen is gone. Any time: the "?" button.
  useEffect(() => {
    const onBootDone = () => {
      if (!hasSeenTutorial()) start();
    };
    if (isBootDone()) onBootDone();
    window.addEventListener(BOOT_DONE_EVENT, onBootDone);
    window.addEventListener(TUTORIAL_OPEN_EVENT, start);
    return () => {
      window.removeEventListener(BOOT_DONE_EVENT, onBootDone);
      window.removeEventListener(TUTORIAL_OPEN_EVENT, start);
    };
  }, [start]);

  const step = steps[index];

  // Keep the ring on its target as the window resizes or panels animate.
  useLayoutEffect(() => {
    if (!open || !step) return;
    const measure = () => setRect(visibleRect(targetElement(step)));
    measure();
    const settle = window.setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
    };
  }, [open, step]);

  // The guide "says" each line: a short mouth flap, then rest.
  useEffect(() => {
    if (!open || prefersReducedMotion()) return;
    setTalking(true);
    const id = window.setTimeout(() => setTalking(false), TALK_MS);
    return () => window.clearTimeout(id);
  }, [open, index, lang]);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open || !step) return null;

  const ui = TUTORIAL_UI[lang];
  const bio = GUIDE_BIOS[step.who];
  const isLast = index === steps.length - 1;
  // Keep the card clear of what it points at.
  const cardAtTop = rect !== null && rect.top + rect.height / 2 > window.innerHeight * 0.55;

  const changeLang = (next: TutorialLang) => {
    setLang(next);
    saveTutorialLang(next);
  };

  return (
    <div className="fixed inset-0 z-[90]" data-testid="first-run-tutorial">
      {/* Blocks the dashboard while the tour runs; the ring cuts a window into the dim. */}
      {rect ? (
        <>
          <div className="absolute inset-0" aria-hidden />
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-2xl transition-all duration-300 motion-reduce:transition-none"
            style={ringBox(rect)}
          />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: DIM }} aria-hidden />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={ui.dialog}
        className={clsx(
          "absolute left-1/2 flex w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 items-end",
          cardAtTop ? "top-20" : "bottom-6 max-md:bottom-20",
        )}
      >
        <div className="relative -mr-6 h-24 shrink-0 self-end sm:-mr-4 sm:h-40">
          <GuidePortrait who={step.who} talking={talking} />
        </div>

        <div key={`${step.id}-${lang}`} className="aeris-pill-surface aeris-rise min-w-0 flex-1 rounded-2xl p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-body-sm font-black text-aeris-text">{bio.name}</div>
              <div className="aeris-label truncate">{bio.role[lang]}</div>
            </div>
            <Segmented
              size="sm"
              ariaLabel={ui.language}
              value={lang}
              onChange={changeLang}
              options={TUTORIAL_LANGS.map((l) => ({
                value: l,
                label: LANG_LABELS[l].short,
                title: LANG_LABELS[l].name,
              }))}
            />
          </div>

          <h2 className="text-[1.0625rem] font-black leading-tight text-aeris-text">
            {step.title[lang]}
          </h2>
          <p className="mt-1 text-body-sm leading-snug text-aeris-muted">{step.text[lang]}</p>

          {/* Wraps on a phone: the step count takes its own line, buttons stay whole. */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <span className="aeris-kicker mr-auto max-sm:basis-full max-sm:justify-center">
              {ui.step(index + 1, steps.length)}
            </span>
            {!isLast ? (
              <button type="button" className="aeris-btn-soft px-3 py-2 text-body-sm" onClick={finish}>
                {ui.skip}
              </button>
            ) : null}
            {index > 0 ? (
              <button
                type="button"
                className="aeris-btn-ghost px-3 py-2 text-body-sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                {ui.back}
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              className="aeris-btn-cta px-4 py-2 text-body-sm"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
            >
              {isLast ? ui.done : ui.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

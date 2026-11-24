import { TUTORIAL_LANGS, type TutorialLang } from "./content";

/** Bump the version to show the tutorial again to everyone after a big change. */
const SEEN_KEY = "aeris:tutorial:v1";
const LANG_KEY = "aeris:tutorial:lang";

/** Fired by the header's "?" button to replay the tutorial. */
export const TUTORIAL_OPEN_EVENT = "aeris:tutorial-open";
/** Fired by BootScreen once the loading screen is gone. */
export const BOOT_DONE_EVENT = "aeris:boot-done";

// localStorage can throw (private mode, blocked site data): every access is guarded.
export function hasSeenTutorial(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "done");
  } catch {
    /* not persisted: the tutorial shows again next visit */
  }
}

export function readTutorialLang(): TutorialLang | null {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    return (TUTORIAL_LANGS as readonly string[]).includes(raw ?? "")
      ? (raw as TutorialLang)
      : null;
  } catch {
    return null;
  }
}

export function saveTutorialLang(lang: TutorialLang): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** True once the boot screen has gone (also covers mounting after it fired). */
export function isBootDone(): boolean {
  return (window as Window & { __aerisBootDone?: boolean }).__aerisBootDone === true;
}

export function signalBootDone(): void {
  (window as Window & { __aerisBootDone?: boolean }).__aerisBootDone = true;
  window.dispatchEvent(new Event(BOOT_DONE_EVENT));
}

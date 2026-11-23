/**
 * True when a keydown came from somewhere the user is typing (search box, chat,
 * report form, phone number). Panel hotkeys are bare digits, so without this
 * check they swallow every number typed into a field (audit 2026-11, B6).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"),
  );
}

/**
 * True when a bare-key panel shortcut should NOT fire: a modifier is held
 * (Ctrl/Meta/Alt belong to the browser/OS) or the user is typing in a field.
 */
export function shouldIgnoreHotkey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  return isTypingTarget(e.target);
}

/** A bare-key shortcut: no Ctrl/Meta/Alt, and not while typing in a field. */
export function isBareHotkey(e: KeyboardEvent): boolean {
  return !shouldIgnoreHotkey(e);
}

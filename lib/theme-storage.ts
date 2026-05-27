export type AppTheme = "light" | "dark";

export const STORAGE_KEY = "aeris-theme";

export const THEME_COLOR_LIGHT = "#f4f8fc";
export const THEME_COLOR_DARK = "#0a0e13";

/** Resolve a raw localStorage value (including Chat's `"system"`) to light or dark. */
export function resolveStoredTheme(
  raw: string | null,
  prefersDark: boolean = false,
): AppTheme {
  if (raw === "dark") return "dark";
  if (raw === "system") return prefersDark ? "dark" : "light";
  return "light";
}

export function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "light";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return resolveStoredTheme(raw, prefersDark);
  } catch {
    return "light";
  }
}

export function readDocumentTheme(): AppTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);

  const color = theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

/** Inline script body for layout.tsx — must stay self-contained (no imports). */
export const THEME_INIT_SCRIPT = `
(() => {
  try {
    const key = "aeris-theme";
    const saved = window.localStorage.getItem(key);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme =
      saved === "dark" ? "dark" :
      saved === "system" ? (prefersDark ? "dark" : "light") :
      "light";
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
    const color = theme === "dark" ? "#0a0e13" : "#f4f8fc";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  } catch {}
})();
`;

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeToDocument,
  readStoredTheme,
  STORAGE_KEY,
  type AppTheme,
} from "@/lib/theme-storage";

export type { AppTheme };

type ThemeContextValue = {
  theme: AppTheme;
  resolvedTheme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** SSR/hydration-safe default — must match `readStoredTheme()` when `window` is undefined. */
const SSR_THEME: AppTheme = "light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The React tree hydrates with the SSR default and flips to the stored
  // theme in an effect — resolving it synchronously in the initializer causes
  // hydration mismatches for theme-dependent markup. The MapLibre basemap
  // does NOT wait for this effect: `Map2D` reads `readStoredTheme()` directly
  // when creating the map (inside a post-hydration effect), so the map style
  // is correct on first load without a second `setStyle()` swap.
  const [theme, setThemeState] = useState<AppTheme>(SSR_THEME);

  useEffect(() => {
    const next = readStoredTheme();
    setThemeState(next);
    applyThemeToDocument(next);
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    applyThemeToDocument(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}

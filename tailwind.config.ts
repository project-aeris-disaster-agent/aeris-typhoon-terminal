import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        aeris: {
          bg: "rgb(var(--aeris-bg) / <alpha-value>)",
          surface: "rgb(var(--aeris-surface) / <alpha-value>)",
          elev: "rgb(var(--aeris-elev) / <alpha-value>)",
          border: "rgb(var(--aeris-border) / <alpha-value>)",
          text: "rgb(var(--aeris-text) / <alpha-value>)",
          muted: "rgb(var(--aeris-muted) / <alpha-value>)",
          accent: "rgb(var(--aeris-accent) / <alpha-value>)",
          warn: "rgb(var(--aeris-warn) / <alpha-value>)",
          danger: "rgb(var(--aeris-danger) / <alpha-value>)",
          ok: "rgb(var(--aeris-ok) / <alpha-value>)",
          ink2: "rgb(var(--aeris-ink2) / <alpha-value>)",
          accent2: "rgb(var(--aeris-accent2) / <alpha-value>)",
          live: "rgb(var(--aeris-live) / <alpha-value>)",
          warm: "rgb(var(--aeris-warm) / <alpha-value>)",
          gold: "rgb(var(--aeris-gold) / <alpha-value>)",
          navy: "rgb(var(--aeris-navy) / <alpha-value>)",
          kicker: "rgb(var(--aeris-kicker-bg) / <alpha-value>)",
          "kicker-ink": "rgb(var(--aeris-kicker-ink) / <alpha-value>)",
          "chip-on": "rgb(var(--aeris-chip-on) / <alpha-value>)",
          rim: "rgb(var(--aeris-hover-rim) / <alpha-value>)",
        },
      },
      // FLOOD CONTROL type: Nunito everywhere. `mono` maps to Nunito too (with
      // tabular figures from globals.css) so the old terminal-style labels pick
      // up the game's look without touching each call site.
      fontFamily: {
        sans: ["var(--font-nunito)", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["var(--font-nunito)", "Segoe UI", "system-ui", "sans-serif"],
        code: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // The game's radii run large: chips 999, buttons 12-16, panels 18, hero 28.
      borderRadius: {
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        md: "0.625rem",
        lg: "0.875rem",
        xl: "1.125rem",
        "2xl": "1.5rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        panel: "var(--aeris-panel-shadow)",
        hero: "var(--aeris-hero-shadow)",
        pill: "var(--aeris-pill-shadow)",
        pop: "var(--aeris-pop-shadow)",
        seg: "var(--aeris-seg-shadow)",
        cta: "var(--aeris-cta-shadow)",
      },
      backgroundImage: {
        card: "var(--aeris-card-fill)",
        cta: "var(--aeris-cta-fill)",
        "cta-warm": "var(--aeris-cta-warm-fill)",
        sky: "var(--aeris-sky)",
        "boot-sky": "var(--aeris-boot-sky)",
      },
      fontSize: {
        chrome: ["0.75rem", { lineHeight: "1.25" }],
        label: ["0.8125rem", { lineHeight: "1.4" }],
        "body-sm": ["0.875rem", { lineHeight: "1.5" }],
        body: ["1rem", { lineHeight: "1.5" }],
        "body-lg": ["1.125rem", { lineHeight: "1.45" }],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "scan-line": "scanline 2s linear infinite",
        aurora: "aurora var(--animation-speed, 60s) linear infinite",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        aurora: {
          from: { backgroundPosition: "50% 50%, 50% 50%" },
          to: { backgroundPosition: "350% 50%, 350% 50%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

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
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "scan-line": "scanline 2s linear infinite",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

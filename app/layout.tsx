import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { SWRegister } from "@/components/SWRegister";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

export const metadata: Metadata = {
  title: "AERIS — Typhoon Resilience Terminal",
  description:
    "Real-time disaster response dashboard for the Philippines. Live typhoon tracking, flood and landslide hazard maps, satellite imagery, and crowdsourced incident reporting.",
  applicationName: "AERIS",
  authors: [{ name: "AERIS PH" }],
  keywords: [
    "typhoon",
    "Philippines",
    "disaster",
    "resilience",
    "PAGASA",
    "NDRRMC",
    "flood",
    "landslide",
  ],
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f4f8fc",
};

const themeInitScript = `
(() => {
  try {
    const key = "aeris-theme";
    const saved = window.localStorage.getItem(key);
    const theme = saved === "dark" ? "dark" : "light";
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <SWRegister />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { SWRegister } from "@/components/SWRegister";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { RoleProvider } from "@/services/role-context";
import { THEME_COLOR_LIGHT, THEME_INIT_SCRIPT } from "@/lib/theme-storage";

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
  themeColor: THEME_COLOR_LIGHT,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <RoleProvider>{children}</RoleProvider>
        </ThemeProvider>
        <SWRegister />
      </body>
    </html>
  );
}

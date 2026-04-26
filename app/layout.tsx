import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { SWRegister } from "@/components/SWRegister";

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
  themeColor: "#0a0e13",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}

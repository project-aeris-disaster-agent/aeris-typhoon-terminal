import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { SWRegister } from "@/components/SWRegister";
import { PrivyProviders } from "@/components/providers/PrivyProviders";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { RoleProvider } from "@/services/role-context";
import { ProfileProvider } from "@/services/profile-context";
import { THEME_COLOR_LIGHT, THEME_INIT_SCRIPT } from "@/lib/theme-storage";

// FLOOD CONTROL by bagyo.app type: Nunito, heavy weights (game theme tokens.ts FONT).
const nunito = Nunito({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "AERIS — Philippines Disaster Dashboard",
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
  themeColor: THEME_COLOR_LIGHT,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={nunito.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={nunito.className}>
        <ThemeProvider>
          <PrivyProviders>
            <RoleProvider>
              <ProfileProvider>
                <MobileAccessGate>{children}</MobileAccessGate>
              </ProfileProvider>
            </RoleProvider>
          </PrivyProviders>
        </ThemeProvider>
        <SWRegister />
      </body>
    </html>
  );
}

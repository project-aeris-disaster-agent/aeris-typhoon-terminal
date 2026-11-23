import { Suspense } from "react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import LoginPage from "./LoginPageClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-boot-sky text-aeris-ink2">
          <AerisLoadingLogo size="lg" variant="glyph" />
          <span className="aeris-label">Loading…</span>
        </div>
      }
    >
      <LoginPage />
    </Suspense>
  );
}

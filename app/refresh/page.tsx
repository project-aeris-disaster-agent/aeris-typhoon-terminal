import { Suspense } from "react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import RefreshPageClient from "./RefreshPageClient";

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
      <RefreshPageClient />
    </Suspense>
  );
}

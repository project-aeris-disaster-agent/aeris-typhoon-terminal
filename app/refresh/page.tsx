import { Suspense } from "react";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import RefreshPageClient from "./RefreshPageClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-aeris-bg text-aeris-muted">
          <AerisLoadingLogo size="lg" variant="splash" />
          <span className="text-body-sm font-mono uppercase tracking-wider">
            Loading…
          </span>
        </div>
      }
    >
      <RefreshPageClient />
    </Suspense>
  );
}

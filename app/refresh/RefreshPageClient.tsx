"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import { clearPrivySessionCookies } from "@/lib/privy-cookies";
import { safePostLoginPath } from "@/lib/safe-redirect";

const REFRESH_TIMEOUT_MS = 12_000;

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  clearPrivySessionCookies();
  const url = reason ? `/login?session_error=${encodeURIComponent(reason)}` : "/login";
  router.replace(url);
}

export default function RefreshPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = safePostLoginPath(searchParams.get("redirect_url"));
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [status, setStatus] = useState("Refreshing session…");
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setStatus("Session refresh timed out. Redirecting to sign-in…");
      redirectToLogin(
        router,
        "Session refresh timed out. If this keeps happening, add this URL to Privy Allowed Origins.",
      );
    }, REFRESH_TIMEOUT_MS);

    const attemptRefresh = async () => {
      if (!ready) return;

      try {
        if (!authenticated) {
          redirectToLogin(router, "Could not refresh your session. Please sign in again.");
          return;
        }

        const token = await Promise.race([
          getAccessToken(),
          new Promise<null>((resolve) =>
            window.setTimeout(() => resolve(null), REFRESH_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;

        if (token) {
          router.replace(redirectUrl);
          return;
        }

        redirectToLogin(router, "Could not refresh your session. Please sign in again.");
      } catch {
        if (!cancelled) {
          redirectToLogin(router, "Session refresh failed. Please sign in again.");
        }
      }
    };

    void attemptRefresh();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [ready, authenticated, getAccessToken, router, redirectUrl]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-aeris-bg px-4 text-center text-aeris-muted">
      <AerisLoadingLogo size="lg" variant="splash" />
      <span className="max-w-sm text-body-sm font-mono uppercase tracking-wider">
        {status}
      </span>
      {!ready && origin && (
        <p className="max-w-md text-body-sm text-aeris-muted/80">
          If this takes more than a few seconds, add{" "}
          <code className="text-aeris-text">{origin}</code> to Privy Dashboard → Configuration →
          App settings → Domains → Allowed Origins.
        </p>
      )}
    </div>
  );
}

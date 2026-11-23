"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import { Kicker } from "@/components/ui/Kit";
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
    // The game's loading screen: sky, one frosted card, spinning mark, status.
    <div className="flex min-h-screen items-center justify-center bg-boot-sky px-4">
      <div
        className="panel-glass aeris-rise flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl !shadow-hero px-7 py-7 text-center"
        role="status"
        aria-live="polite"
      >
        <Kicker>Session</Kicker>
        <AerisLoadingLogo size="lg" variant="glyph" />
        <span className="text-body font-black text-aeris-text">{status}</span>
        {!ready && origin && (
          <p className="text-body-sm font-bold text-aeris-ink2">
            If this takes more than a few seconds, add{" "}
            <code className="rounded bg-aeris-elev px-1 font-code text-[0.75rem] text-aeris-text">
              {origin}
            </code>{" "}
            to Privy Dashboard → Configuration → App settings → Domains → Allowed
            Origins.
          </p>
        )}
      </div>
    </div>
  );
}

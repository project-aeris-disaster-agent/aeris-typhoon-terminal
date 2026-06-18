"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLogin, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useTheme } from "@/components/providers/ThemeProvider";
import { AerisLoadingLogo } from "@/components/ui/AerisLoadingLogo";
import { isPrivyConfigured } from "@/lib/privy-config";
import { safePostLoginPath } from "@/lib/safe-redirect";

function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  );
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}

type LoadingPhase = "preparing" | "signing-in" | "redirecting" | null;

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safePostLoginPath(searchParams.get("next"));
  const sessionError = searchParams.get("session_error");
  const { theme, toggleTheme } = useTheme();
  const privyEnabled = isPrivyConfigured();
  const { ready, authenticated } = usePrivy();
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(
    privyEnabled ? "preparing" : null,
  );
  const [status, setStatus] = useState<string | null>(sessionError);
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const rawNext = searchParams.get("next");
    if (!rawNext) return;

    const safeNext = safePostLoginPath(rawNext);
    if (safeNext === rawNext) return;

    const params = new URLSearchParams(searchParams.toString());
    if (safeNext === "/") {
      params.delete("next");
    } else {
      params.set("next", safeNext);
    }

    const query = params.toString();
    router.replace(query ? `/login?${query}` : "/login");
  }, [router, searchParams]);

  const redirectToDashboard = useCallback(() => {
    setLoadingPhase("redirecting");
    router.refresh();
    router.replace(nextPath);
  }, [router, nextPath]);

  const loginCallbacks = {
    onComplete: () => {
      // Fire-and-forget: create/refresh the Supabase profile for this Privy
      // user. The ProfileProvider also re-syncs on app load as a safety net.
      void fetch("/api/user/sync", { method: "POST", cache: "no-store" }).catch(
        () => undefined,
      );
      redirectToDashboard();
    },
    onError: () => {
      setLoadingPhase(null);
      setStatus("Sign-in failed. Please try again.");
    },
  };

  const { login } = useLogin(loginCallbacks);

  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    ...loginCallbacks,
    onError: (errorCode) => {
      setLoadingPhase(null);
      const isOriginError =
        typeof errorCode === "string" && errorCode.toLowerCase().includes("origin");
      setStatus(
        isOriginError
          ? `Origin not allowed — add ${origin ?? window.location.origin} to Privy Dashboard → Configuration → App settings → Domains → Allowed Origins.`
          : "Sign-in failed. Please try again.",
      );
    },
  });

  useEffect(() => {
    if (privyEnabled && ready && loadingPhase === "preparing") {
      setLoadingPhase(null);
    }
  }, [privyEnabled, ready, loadingPhase]);

  useEffect(() => {
    if (!privyEnabled || ready) return;
    const timeout = window.setTimeout(() => {
      setLoadingPhase(null);
      setStatus(
        (current) =>
          current ??
          `Privy could not initialize. Add ${origin ?? "this site's URL"} to Allowed Origins in the Privy Dashboard.`,
      );
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [privyEnabled, ready, origin]);

  useEffect(() => {
    fetch("/api/auth/role", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.userId) redirectToDashboard();
      })
      .catch(() => undefined);
  }, [redirectToDashboard]);

  useEffect(() => {
    if (privyEnabled && ready && authenticated) {
      redirectToDashboard();
    }
  }, [privyEnabled, ready, authenticated, redirectToDashboard]);

  const handleGoogleLogin = async () => {
    if (!ready || authenticated || oauthLoading) return;
    setStatus(null);
    setLoadingPhase("signing-in");
    try {
      await initOAuth({ provider: "google" });
    } catch {
      setLoadingPhase(null);
    }
  };

  const handleWalletLogin = () => {
    if (!ready || authenticated) return;
    setStatus(null);
    setLoadingPhase("signing-in");
    login({ loginMethods: ["wallet"] });
  };

  const loadingMessage =
    loadingPhase === "preparing"
      ? "Preparing sign-in…"
      : loadingPhase === "signing-in"
        ? "Signing you in…"
        : loadingPhase === "redirecting"
          ? "Opening dashboard…"
          : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-aeris-bg px-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-aeris-border bg-aeris-surface p-6 shadow-xl">
        {loadingMessage && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-aeris-surface/85 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
          >
            <AerisLoadingLogo size="md" variant="glyph" />
            <span className="text-body-sm text-aeris-muted">{loadingMessage}</span>
          </div>
        )}

        <AerisLoadingLogo
          variant="logo"
          size="md"
          className="mx-auto mb-4 max-h-12"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-body-lg font-semibold text-aeris-text">AERIS Dashboard</h1>
            <p className="mt-2 text-body-sm text-aeris-muted">
              Sign in to view live disaster intelligence for the Philippines.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded border border-aeris-border bg-aeris-bg/70 px-2 text-aeris-muted transition-colors hover:border-aeris-accent/40 hover:text-aeris-text"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title="Toggle light/dark theme"
          >
            {theme === "dark" ? (
              <SunIcon className="h-3.5 w-3.5" />
            ) : (
              <MoonIcon className="h-3.5 w-3.5" />
            )}
            <span className="hud-text text-body-sm">{theme === "dark" ? "Dark" : "Light"}</span>
          </button>
        </div>

        {privyEnabled && (
          <div className="mt-6 border-t border-aeris-border/70 pt-6">
            <p className="text-label text-aeris-muted">Primary sign-in</p>
            <p className="mt-1 text-body-sm text-aeris-muted">
              Google uses a full-page redirect (works in Cursor&apos;s browser). Wallet connect may
              require Chrome or Firefox.
            </p>
            <button
              type="button"
              disabled={!ready || authenticated || loadingPhase !== null || oauthLoading}
              onClick={() => void handleGoogleLogin()}
              className="mt-4 w-full rounded border border-aeris-accent/40 bg-aeris-accent/15 px-3 py-2.5 text-body-sm font-semibold text-aeris-accent disabled:opacity-40 min-h-[44px]"
            >
              Continue with Google
            </button>
            <button
              type="button"
              disabled={!ready || authenticated || loadingPhase !== null}
              onClick={handleWalletLogin}
              className="mt-2 w-full rounded border border-aeris-border bg-aeris-bg/70 px-3 py-2.5 text-body-sm font-semibold text-aeris-text disabled:opacity-40 min-h-[44px]"
            >
              Connect wallet
            </button>
            {origin && (
              <p className="mt-3 text-xs text-aeris-muted/80">
                If you see &ldquo;Origin not allowed&rdquo;, add{" "}
                <code className="text-aeris-text">{origin}</code> in Privy Dashboard →
                Configuration → App settings → Domains → Allowed Origins.
              </p>
            )}
          </div>
        )}

        {status && (
          <p className="mt-4 rounded border border-aeris-border/70 bg-aeris-bg px-3 py-2 text-xs text-aeris-muted">
            {status}
          </p>
        )}

      </div>
    </div>
  );
}

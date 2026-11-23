"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLogin, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useTheme } from "@/components/providers/ThemeProvider";
import {
  AerisCharIllustration,
  AerisLoadingLogo,
} from "@/components/ui/AerisLoadingLogo";
import { Kicker } from "@/components/ui/Kit";
import { MobileDesktopGate } from "@/components/MobileDesktopGate";
import { isMobileDeviceClient } from "@/lib/mobile-access";
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
  const { ready, authenticated, getAccessToken } = usePrivy();
  const redirectingRef = useRef(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(
    privyEnabled ? "preparing" : null,
  );
  const [status, setStatus] = useState<string | null>(sessionError);
  const [mobile, setMobile] = useState(false);
  const [sessionRole, setSessionRole] = useState<string | null>(null);

  useEffect(() => {
    setMobile(isMobileDeviceClient());
  }, []);

  const mobileBlocked =
    mobile && sessionRole !== null && sessionRole !== "admin";
  const showMobileGate = mobile && (!authenticated || mobileBlocked);

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

  const redirectToDashboard = useCallback(async () => {
    if (redirectingRef.current) return;

    if (mobile) {
      try {
        const res = await fetch("/api/auth/role", { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as { role?: string }) : null;
        if (data?.role !== "admin") {
          setSessionRole(data?.role ?? "guest_viewer");
          redirectingRef.current = false;
          setLoadingPhase(null);
          setStatus("Mobile access is limited to admin wallet login.");
          return;
        }
      } catch {
        setLoadingPhase(null);
        setStatus("Could not verify access. Please try again.");
        return;
      }
    }

    redirectingRef.current = true;
    setLoadingPhase("redirecting");

    try {
      if (privyEnabled) {
        await Promise.race([
          getAccessToken(),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8_000)),
        ]);
      }
      window.location.assign(nextPath);
    } catch {
      redirectingRef.current = false;
      setLoadingPhase(null);
      setStatus("Sign-in succeeded but redirect failed. Please try again.");
    }
  }, [nextPath, privyEnabled, getAccessToken, mobile]);

  const loginCallbacks = {
    onComplete: () => {
      // Fire-and-forget: create/refresh the Supabase profile for this Privy
      // user. The ProfileProvider also re-syncs on app load as a safety net.
      void fetch("/api/user/sync", { method: "POST", cache: "no-store" }).catch(
        () => undefined,
      );
      void redirectToDashboard();
    },
    onError: () => {
      setLoadingPhase(null);
      setStatus("Sign-in failed. Please try again.");
    },
  };

  const { login } = useLogin(loginCallbacks);

  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth(loginCallbacks);

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
        (current) => current ?? "Sign-in is temporarily unavailable. Please try again.",
      );
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [privyEnabled, ready]);

  useEffect(() => {
    fetch("/api/auth/role", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.userId) return;
        setSessionRole(data.role ?? "guest_viewer");
        if (!mobile || data.role === "admin") {
          void redirectToDashboard();
        }
      })
      .catch(() => undefined);
  }, [redirectToDashboard, mobile]);

  useEffect(() => {
    if (privyEnabled && ready && authenticated) {
      void redirectToDashboard();
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

  // FLOOD CONTROL landing (bagyogame landingStyles): sky backdrop, brand pill
  // and round settings button on top, the frosted hero card on the left, and
  // AERIS on the right with a speech bubble. Sign-in logic is unchanged.
  return (
    <div className="relative flex min-h-screen items-center bg-boot-sky px-4 py-20 md:px-14">
      {showMobileGate && (
        <MobileDesktopGate
          showWalletLogin={privyEnabled && !mobileBlocked}
          onWalletLogin={handleWalletLogin}
          walletLoginDisabled={!ready || authenticated || loadingPhase !== null}
        />
      )}

      {/* Top bar */}
      <div className="absolute inset-x-4 top-5 flex items-center justify-between gap-3 md:inset-x-10">
        <div className="aeris-pill-surface flex items-center gap-2 rounded-full py-1 pl-1 pr-4">
          <AerisLoadingLogo size="sm" variant="glyph" spin={false} />
          <span className="text-[0.9375rem] font-black text-aeris-text">bagyo.app</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="aeris-round !px-3.5 text-body-sm"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title="Toggle light/dark theme"
        >
          {theme === "dark" ? (
            <SunIcon className="h-4 w-4" />
          ) : (
            <MoonIcon className="h-4 w-4" />
          )}
          <span>{theme === "dark" ? "Storm" : "Day"}</span>
        </button>
      </div>

      {/* AERIS with her speech bubble (desktop) */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-[6%] hidden lg:block"
      >
        <div className="panel-glass absolute -left-56 top-10 w-64 rounded-2xl rounded-br-md px-4 py-3 !shadow-pill">
          <div className="text-[0.625rem] font-black uppercase tracking-[0.16em] text-aeris-kicker-ink">
            A.E.R.I.S.
          </div>
          <p className="mt-1 text-body-sm font-extrabold leading-snug text-aeris-text">
            Magandang araw! Sign in to see live storm tracks, hazards and
            ground reports.
          </p>
        </div>
        <AerisCharIllustration size="lg" scale={4} />
      </div>

      {/* Hero card */}
      <main className="panel-glass aeris-rise relative z-[2] w-full max-w-[30rem] overflow-hidden rounded-3xl !shadow-hero px-7 pb-6 pt-7 sm:px-8">
        {loadingMessage && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-aeris-surface/85 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
          >
            <AerisLoadingLogo size="md" variant="glyph" />
            <span className="text-body-sm font-extrabold text-aeris-ink2">{loadingMessage}</span>
          </div>
        )}

        <Kicker>Philippines · Disaster dashboard</Kicker>

        <h1 className="mt-4 flex flex-col leading-[0.9]">
          <span className="text-[3.25rem] font-black tracking-[0.015em] text-aeris-text sm:text-[3.75rem]">
            Sign in to
          </span>
          <span className="aeris-title-fill aeris-wave self-start pb-3 text-[3.25rem] font-black tracking-[0.015em] sm:text-[3.75rem]">
            A.E.R.I.S.
          </span>
        </h1>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-body-sm font-extrabold text-aeris-muted">by</span>
          <span
            role="img"
            aria-label="bagyo.app — powered by A.E.R.I.S."
            className="aeris-brand-mark h-9"
          />
        </div>
        <p className="mt-2 text-[0.9375rem] font-bold text-aeris-ink2">
          Live disaster intelligence for the Philippines.
        </p>

        {privyEnabled && !mobile && (
          <div className="mt-6 space-y-2.5">
            <div className="aeris-label">Sign in with</div>
            <button
              type="button"
              disabled={!ready || authenticated || loadingPhase !== null || oauthLoading}
              onClick={() => void handleGoogleLogin()}
              className="aeris-btn-cta w-full min-h-[52px] px-4 text-[0.9375rem]"
            >
              Continue with Google
            </button>
            <button
              type="button"
              disabled={!ready || authenticated || loadingPhase !== null}
              onClick={handleWalletLogin}
              className="aeris-btn-ghost w-full min-h-[44px] px-4 text-body-sm disabled:opacity-40"
            >
              Connect wallet
            </button>
          </div>
        )}

        {status && (
          <p
            role="status"
            className="aeris-incident mt-4 px-3 py-2 text-xs font-extrabold text-aeris-ink2"
          >
            {status}
          </p>
        )}

        <p className="mt-6 text-[0.6875rem] font-bold leading-snug text-aeris-muted">
          Not an official PAGASA product. Follow PAGASA, NDRRMC and your LGU
          for evacuation orders.
        </p>
      </main>
    </div>
  );
}

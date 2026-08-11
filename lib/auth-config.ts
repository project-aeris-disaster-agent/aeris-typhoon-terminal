import { isPrivyConfigured, privyServerEnvMissing } from "@/lib/privy-config";

export function isProductionDeploy(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Local/preview escape hatch that turns off the whole session gate. The E2E
 * suite depends on it (playwright.config.ts), so it cannot simply be deleted.
 *
 * It is ignored outright in production. Set there, it previously waved every
 * request through middleware, handed `authorizeReportReview` operator rights,
 * and made `/api/auth/role` answer `admin` to anonymous callers — one env var
 * between a live deploy and an open report-verification and bulk-mint API.
 * A flag that dangerous should not be one typo away, and production has no
 * legitimate use for it.
 */
export function isDashboardAuthDisabled(): boolean {
  if (isProductionDeploy()) return false;
  return process.env.DASHBOARD_AUTH_DISABLED === "true";
}

export function supabaseAuthEnvMissing(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );
}

export function productionAuthMisconfigured(): boolean {
  if (!isProductionDeploy() || isDashboardAuthDisabled()) {
    return false;
  }

  const privyReady = isPrivyConfigured() && !privyServerEnvMissing();
  const supabaseReady = !supabaseAuthEnvMissing();

  return !privyReady || !supabaseReady;
}

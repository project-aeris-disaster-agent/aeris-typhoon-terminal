import { isPrivyConfigured, privyServerEnvMissing } from "@/lib/privy-config";

export function isDashboardAuthDisabled(): boolean {
  return process.env.DASHBOARD_AUTH_DISABLED === "true";
}

export function isProductionDeploy(): boolean {
  return process.env.VERCEL_ENV === "production";
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

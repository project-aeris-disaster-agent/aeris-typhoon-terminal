/** @jest-environment node */
export {};

import {
  isDashboardAuthDisabled,
  isProductionDeploy,
  productionAuthMisconfigured,
  supabaseAuthEnvMissing,
} from "./auth-config";

describe("auth-config", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.VERCEL_ENV;
    delete process.env.DASHBOARD_AUTH_DISABLED;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
  });

  afterEach(() => {
    process.env = env;
  });

  it("detects production deploy from VERCEL_ENV", () => {
    process.env.VERCEL_ENV = "production";
    expect(isProductionDeploy()).toBe(true);
    process.env.VERCEL_ENV = "preview";
    expect(isProductionDeploy()).toBe(false);
  });

  it("flags production misconfiguration when Privy or Supabase auth env is absent", () => {
    process.env.VERCEL_ENV = "production";
    expect(productionAuthMisconfigured()).toBe(true);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(productionAuthMisconfigured()).toBe(true);

    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "privy-app-id";
    process.env.PRIVY_APP_SECRET = "privy-secret";
    expect(productionAuthMisconfigured()).toBe(false);
  });

  it("does not require Supabase when auth is disabled", () => {
    process.env.VERCEL_ENV = "production";
    process.env.DASHBOARD_AUTH_DISABLED = "true";
    expect(productionAuthMisconfigured()).toBe(false);
    expect(isDashboardAuthDisabled()).toBe(true);
  });

  it("reports missing Supabase env", () => {
    expect(supabaseAuthEnvMissing()).toBe(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(supabaseAuthEnvMissing()).toBe(false);
  });
});

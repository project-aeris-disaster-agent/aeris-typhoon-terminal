import { jsonOkNoStore } from "@/lib/api-response";
import {
  isDashboardAuthDisabled,
  isProductionDeploy,
  supabaseAuthEnvMissing,
} from "@/lib/auth-config";
import {
  getMindsAerisMindId,
  getMindsBuilderApiKey,
  isMindsNotifyEnabled,
} from "@/lib/minds-config";
import packageJson from "../../../package.json";

export const runtime = "edge";

function isMindsNotifyMisconfigured(): boolean {
  if (!isMindsNotifyEnabled()) return false;
  return !getMindsBuilderApiKey() || !getMindsAerisMindId();
}

const PROD_KV = ["KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
const PROD_AUTH = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const PROD_CRON = ["CRON_SECRET"] as const;

function missing(keys: readonly string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim());
}

export async function GET() {
  const production = isProductionDeploy();
  const authDisabled = isDashboardAuthDisabled();

  const required: string[] = [];
  const warnings: string[] = [];

  if (production) {
    required.push(...missing(PROD_KV));
    if (!authDisabled) {
      required.push(...missing(PROD_AUTH));
    }
    required.push(...missing(PROD_CRON));
  } else {
    if (missing(PROD_KV).length > 0) {
      warnings.push("KV not configured (in-memory store in dev)");
    }
    if (!authDisabled && supabaseAuthEnvMissing()) {
      warnings.push("Supabase auth env missing");
    }
    if (missing(PROD_CRON).length > 0) {
      warnings.push("CRON_SECRET not set (cron routes will 401)");
    }
  }

  if (isMindsNotifyMisconfigured()) {
    warnings.push(
      "MINDS_NOTIFY_ENABLED is true but MINDS_BUILDER_API_KEY or MINDS_AERIS_MIND_ID is missing",
    );
  }

  const ok = required.length === 0;

  return jsonOkNoStore(
    {
      ok,
      service: packageJson.name,
      version: packageJson.version,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      time: new Date().toISOString(),
      checks: {
        env: ok ? "ok" : "degraded",
        missing: required,
        warnings,
        kv: missing(PROD_KV).length === 0 ? "configured" : "absent",
        auth: authDisabled ? "disabled" : supabaseAuthEnvMissing() ? "absent" : "configured",
        cron: missing(PROD_CRON).length === 0 ? "configured" : "absent",
      },
    },
    ok ? 200 : 503,
  );
}

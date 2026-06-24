/**
 * Smoke test for Minds Builder integration.
 *
 * Usage:
 *   npx tsx scripts/minds-smoke.ts
 *
 * Requires in .env / .env.local:
 *   MINDS_BUILDER_API_KEY, MINDS_AERIS_MIND_ID
 * Optional:
 *   MINDS_API_SECRET, MINDS_WATCH_ALIAS, NEXT_PUBLIC_SITE_URL
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadDotEnv();

async function loadMindsClient() {
  return import("@animocabrands/minds-client-lib");
}

async function main() {
  const mindsLib = await loadMindsClient();
  const { createMindsClient } = mindsLib;

  const {
    getMindsAerisMindId,
    getMindsApiSecret,
    getMindsBuilderApiKey,
    getMindsWatchAlias,
    getDashboardPublicUrl,
  } = await import("../lib/minds-config");

  console.log("=== AERIS Minds smoke test ===\n");

  const builderApiKey = getMindsBuilderApiKey();
  const mindId = getMindsAerisMindId();
  if (!builderApiKey || !mindId) {
    console.error(
      "FAIL: Set MINDS_BUILDER_API_KEY and MINDS_AERIS_MIND_ID in .env.local",
    );
    process.exit(1);
  }

  const client = createMindsClient({ builderApiKey });
  const alias = getMindsWatchAlias();

  console.log("1. Listing Minds...");
  const minds = await client.listMinds();
  console.log(`   Found ${minds.length} mind(s).`);
  const match = minds.find((m) => m.mindId === mindId);
  if (!match) {
    console.warn(
      `   WARN: MINDS_AERIS_MIND_ID=${mindId} not in list — verify the id.`,
    );
  } else {
    console.log(`   OK: ${match.name ?? match.mindId}`);
  }

  console.log("\n2. Ensuring conversation...");
  await client.ensureConversation(alias, mindId);
  console.log(`   OK: alias "${alias}" → mind ${mindId}`);

  console.log("\n3. Sending test message...");
  const stamp = new Date().toISOString();
  await client.ensureConversation(alias, mindId);
  const sendResult = await client.sendMessage({
    alias,
    messageText: [
      "AERIS Minds smoke test",
      `Timestamp: ${stamp}`,
      `Dashboard: ${getDashboardPublicUrl()}`,
      "If you see this on Telegram/email, Watch Officer routing works.",
    ].join("\n"),
  });
  const fingerprint =
    typeof sendResult.fingerprint === "string" ? sendResult.fingerprint : undefined;
  console.log(`   OK: sent${fingerprint ? ` (fingerprint ${fingerprint})` : ""}`);

  const secret = getMindsApiSecret();
  if (!secret) {
    console.log(
      "\n4. Snapshot API — SKIP (MINDS_API_SECRET not set)",
    );
  } else {
    console.log("\n4. Fetching snapshot API...");
    const base = getDashboardPublicUrl();
    const url = `${base}/api/internal/minds/snapshot`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.error(
        `   FAIL: ${res.status} ${res.statusText} — is the dev server running at ${base}?`,
      );
      process.exit(1);
    }
    const body = (await res.json()) as { generatedAt?: string; national?: unknown };
    console.log(
      `   OK: generatedAt=${body.generatedAt ?? "n/a"}, national verdict present=${Boolean(body.national)}`,
    );
  }

  console.log("\n=== All checks passed ===");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});

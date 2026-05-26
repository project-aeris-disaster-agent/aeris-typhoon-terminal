/**
 * Phase 6.6 - End-to-end mint testnet smoke.
 *
 * Inserts a synthetic verified report directly into Supabase, marks it
 * onchain_mint_status=queued, then runs the mint worker against the active
 * SKALE-Base network (default: testnet). On success it prints the tx hash
 * and explorer URL.
 *
 * Run:
 *   npm run smoke:mint
 *
 * Reads from .env.local first, then .env (same precedence as Next.js).
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   AERIS_ONCHAIN_NETWORK              skale-base-testnet (default)
 *   AERIS_REPORTS_CONTRACT_ADDRESS     0x...
 *   AERIS_SERVICE_PRIVATE_KEY          0x...
 *   PINATA_JWT                         optional - uses dev-skip pinning if absent
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tiny .env loader so `npx tsx scripts/mint-testnet.ts` picks up local secrets
// without requiring a Node flag. Mirrors Next.js precedence: .env.local > .env.
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

import { mintQueuedReports } from "@/services/onchain-mint-worker";

type InsertResult = { id: string; report_message_id: string };

async function insertSyntheticReport(): Promise<InsertResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the smoke script.",
    );
  }

  const messageId = `AERIS-SMOKE-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const payload = {
    report_message_id: messageId,
    source_app: "aeris-dashboard",
    source_channel: "testnet_e2e_smoke",
    category: "flood",
    description: "[E2E smoke] synthetic verified report for SKALE-Base mint testing.",
    longitude: 121.1063,
    latitude: 14.6433,
    confidence: 0.9,
    verification_status: "verified",
    moderation_status: "visible",
    confirmations: 0,
    phone_verification_status: "verified",
    onchain_network: process.env.AERIS_ONCHAIN_NETWORK ?? "skale-base-testnet",
    onchain_chain_id: 324705682,
    onchain_mint_status: "queued",
    ai_priority: "urgent",
    metadata: { source: "scripts/mint-testnet.ts", smoke: true },
  };

  const res = await fetch(`${url}/rest/v1/disaster_reports?select=id,report_message_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Insert failed (${res.status}): ${detail}`);
  }
  const rows = (await res.json()) as InsertResult[];
  if (!rows[0]) throw new Error("Insert returned no row");
  return rows[0];
}

async function main() {
  console.log("== AERIS mint testnet smoke ==");
  console.log("Network:", process.env.AERIS_ONCHAIN_NETWORK ?? "skale-base-testnet");
  console.log("Contract:", process.env.AERIS_REPORTS_CONTRACT_ADDRESS ?? "(not set)");

  const inserted = await insertSyntheticReport();
  console.log("\n[1/2] inserted synthetic verified report:");
  console.log("       id        =", inserted.id);
  console.log("       messageId =", inserted.report_message_id);

  console.log("\n[2/2] running mint worker (drains queue FIFO until smoke row processed)...");
  // The worker pulls in FIFO order, so any pre-existing queued rows are
  // minted before ours. Loop a few passes so the smoke row is reached.
  let target: Awaited<ReturnType<typeof mintQueuedReports>>["results"][number] | undefined;
  const allResults: typeof target[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const summary = await mintQueuedReports({
      limit: 5,
      deadlineAt: Date.now() + 90_000,
      safetyMarginMs: 5_000,
    });
    console.log(`\n== Pass ${pass + 1} summary ==`);
    console.log(JSON.stringify(summary, null, 2));
    for (const r of summary.results) allResults.push(r);
    target = summary.results.find((r) => r.reportId === inserted.id);
    if (target) break;
    if (summary.attempted === 0) break;
  }
  if (!target) {
    console.error("\n[FAIL] worker did not process the smoke report after draining queue.");
    console.error("Processed in this run:", allResults.map((r) => r?.reportId));
    process.exit(1);
  }
  if (target.status !== "minted" && target.status !== "already_minted") {
    console.error(`\n[FAIL] mint status = ${target.status}: ${target.reason ?? ""}`);
    process.exit(1);
  }
  console.log("\n[OK] mint succeeded.");
  if (target.txHash) console.log("Tx hash :", target.txHash);
  if (target.tokenId) console.log("Token id:", target.tokenId);
  if (target.explorerUrl) console.log("Explorer:", target.explorerUrl);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});

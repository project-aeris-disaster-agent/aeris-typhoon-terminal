/**
 * Minds lifecycle/cognition admin for incident response.
 *
 * Usage:
 *   npx tsx scripts/minds-admin.ts show               # Mind details
 *   npx tsx scripts/minds-admin.ts enable             # resume the Mind
 *   npx tsx scripts/minds-admin.ts disable            # pause the Mind
 *   npx tsx scripts/minds-admin.ts balance            # cognition balance
 *   npx tsx scripts/minds-admin.ts usage [interval]   # spend by tool (hour|day|week|month)
 *
 * Targets MINDS_AERIS_MIND_ID by default; override with --mind <MIND_ID>.
 * Requires MINDS_BUILDER_API_KEY in .env / .env.local.
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

const USAGE_INTERVALS = ["hour", "day", "week", "month"] as const;
type UsageInterval = (typeof USAGE_INTERVALS)[number];

function parseArgs(): { command: string; mindId?: string; interval: UsageInterval } {
  const args = process.argv.slice(2);
  let mindId: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mind") {
      mindId = args[++i];
    } else {
      positional.push(args[i]);
    }
  }
  const command = positional[0] ?? "show";
  const rawInterval = positional[1] ?? "day";
  const interval = (USAGE_INTERVALS as readonly string[]).includes(rawInterval)
    ? (rawInterval as UsageInterval)
    : "day";
  return { command, mindId, interval };
}

async function main() {
  const { createMindsClient } = await import("@animocabrands/minds-client-lib");
  const { getMindsAerisMindId, getMindsBuilderApiKey, getMindsCognitionWarnThreshold } =
    await import("../lib/minds-config");

  const { command, mindId: mindIdArg, interval } = parseArgs();

  const builderApiKey = getMindsBuilderApiKey();
  if (!builderApiKey) {
    console.error("FAIL: MINDS_BUILDER_API_KEY is not set.");
    process.exit(1);
  }
  const mindId = mindIdArg ?? getMindsAerisMindId();
  if (!mindId) {
    console.error("FAIL: pass --mind <MIND_ID> or set MINDS_AERIS_MIND_ID.");
    process.exit(1);
  }

  const client = createMindsClient({ builderApiKey });

  switch (command) {
    case "show": {
      const mind = await client.getMind(mindId);
      console.log(`Mind:     ${mind.name ?? "(unnamed)"} (${mind.mindId})`);
      console.log(`Enabled:  ${mind.isEnabled === false ? "NO — paused" : "yes"}`);
      console.log(`Model:    ${mind.model ?? "n/a"}`);
      console.log(`Email:    ${mind.email ?? "n/a"}`);
      console.log(`Telegram: ${mind.hasTelegram ? "connected" : "not connected"}`);
      console.log(`Wallet:   ${mind.walletAddress ?? "n/a"} (${mind.chain ?? "n/a"})`);
      break;
    }
    case "enable":
    case "disable": {
      const enabled = command === "enable";
      const mind = await client.updateMindStatus(mindId, { isEnabled: enabled });
      console.log(
        `OK: ${mind.name ?? mind.mindId} is now ${mind.isEnabled === false ? "disabled" : "enabled"}.`,
      );
      break;
    }
    case "balance": {
      const balance = await client.getCognitionBalance(mindId);
      const threshold = getMindsCognitionWarnThreshold();
      console.log(`Cognition balance: ${balance.cognition}`);
      if (balance.cognition < threshold) {
        console.warn(`WARN: below warn threshold (${threshold}) — top up soon.`);
      }
      break;
    }
    case "usage": {
      const usage = await client.getCognitionUsageByTool(mindId, { interval });
      if (usage.summary.length === 0) {
        console.log(`No tool usage recorded (interval: ${interval}).`);
        break;
      }
      console.log(`Cognition usage by tool (interval: ${interval}):`);
      for (const row of usage.summary) {
        console.log(
          `  ${row.tool}: ${row.creditsUsed} credits across ${row.callCount} call(s)` +
            (row.lastUsed ? ` — last used ${row.lastUsed}` : ""),
        );
      }
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Use: show | enable | disable | balance | usage [hour|day|week|month]`,
      );
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});

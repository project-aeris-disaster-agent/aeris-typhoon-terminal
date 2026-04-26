import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const env = parseEnv(readFileSync(envPath, "utf8"));

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

const shouldInsert = process.argv.includes("--insert");
const keyRole = decodeJwtRole(serviceRoleKey);

console.log(`supabase_key_role=${keyRole ?? "unknown"}`);

const listUrl = `${supabaseUrl}/rest/v1/disaster_reports?select=id,source_app,category,verification_status,created_at&order=created_at.desc&limit=1`;
const listResponse = await fetch(listUrl, { headers });

if (listResponse.status === 404) {
  console.error("disaster_reports table was not found. Apply the Supabase migration first.");
  process.exit(2);
}

if (!listResponse.ok) {
  console.error(`Supabase report read failed with status ${listResponse.status}.`);
  process.exit(1);
}

const reports = await listResponse.json();
console.log(`reports_read_ok count=${Array.isArray(reports) ? reports.length : 0}`);

if (shouldInsert) {
  if (keyRole !== "service_role") {
    console.error("Insert smoke requires SUPABASE_SERVICE_ROLE_KEY to be a service_role JWT.");
    process.exit(3);
  }

  const insertResponse = await fetch(
    `${supabaseUrl}/rest/v1/disaster_reports?select=id,source_app,category,verification_status,confidence`,
    {
      method: "POST",
      headers: {
        ...headers,
        prefer: "return=representation",
      },
      body: JSON.stringify({
        source_app: "external",
        source_channel: "smoke_test",
        category: "flood",
        description: "Smoke test report from AERIS dashboard integration.",
        longitude: 120.9842,
        latitude: 14.5995,
        confidence: 0.1,
        verification_status: "unverified",
        moderation_status: "hidden",
        metadata: { smokeTest: true },
      }),
    },
  );

  if (!insertResponse.ok) {
    console.error(`Supabase report insert failed with status ${insertResponse.status}.`);
    process.exit(1);
  }

  const inserted = await insertResponse.json();
  console.log(`reports_insert_ok id=${inserted[0]?.id ?? "unknown"}`);
}

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function decodeJwtRole(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

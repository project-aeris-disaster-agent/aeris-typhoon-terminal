import { computeDedupeHash } from "@/lib/dedupe-hash";

export type AiPriority = "pending" | "urgent" | "low_priority" | "rejected";

type SupabaseReportRow = {
  id: string;
  report_message_id: string | null;
  source_app: string | null;
  source_channel: string | null;
  category: string;
  description: string;
  longitude: number;
  latitude: number;
  photo_url: string | null;
  confidence: number | null;
  verification_status: string | null;
  moderation_status: string | null;
  confirmations: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_actor_type: string | null;
  operator_note: string | null;
  phone_verification_status: string | null;
  proxy_wallet_id: string | null;
  proxy_wallet_address: string | null;
  onchain_network: string | null;
  onchain_chain_id: number | null;
  onchain_mint_status: string | null;
  onchain_tx_hash: string | null;
  onchain_token_id: string | null;
  onchain_minted_at: string | null;
  ai_priority: string | null;
  ai_triage_at: string | null;
  ai_triage_rationale: string | null;
  ai_triage_confidence: number | null;
  dedupe_hash: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type PublicReport = {
  id: string;
  messageId?: string;
  category: string;
  description: string;
  position: [number, number];
  photoUrl?: string;
  createdAt: string;
  confirmations: number;
  sourceApp?: string;
  sourceChannel?: string;
  confidence?: number;
  verificationStatus?: string;
  moderationStatus?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewActorType?: string;
  operatorNote?: string;
  phoneVerificationStatus?: string;
  aiPriority?: AiPriority;
  aiTriageAt?: string;
  aiTriageRationale?: string;
  aiTriageConfidence?: number;
  dedupeHash?: string;
  sessionId?: string;
  anonymousId?: string;
  metadata?: Record<string, unknown>;
  onchain?: {
    proxyWallet?: {
      id?: string;
      address?: string;
      network: string;
      chainId: number;
    };
    mint: {
      network: string;
      chainId: number;
      status: string;
      txHash?: string;
      tokenId?: string;
      mintedAt?: string;
    };
  };
};

export type ReportInsert = {
  category: string;
  description: string;
  position: [number, number];
  photoUrl?: string;
  locationAccuracyM?: number;
  ipHash: string;
  metadata?: Record<string, unknown>;
  sourceApp?: string;
  sourceChannel?: string;
  anonymousId?: string;
};

export type ReportReviewAction =
  | "verify"
  | "reject"
  | "duplicate"
  | "hide"
  | "unhide"
  | "needs_review"
  | "unverify"
  | "note"
  | "confidence_adjust";

export type ReportReviewInput = {
  reportId: string;
  action: ReportReviewAction;
  actorType: "human_operator" | "ai_agent" | "system";
  actorId?: string;
  note?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

const REPORT_COLUMNS = [
  "id",
  "report_message_id",
  "source_app",
  "source_channel",
  "category",
  "description",
  "longitude",
  "latitude",
  "photo_url",
  "confidence",
  "verification_status",
  "moderation_status",
  "confirmations",
  "reviewed_by",
  "reviewed_at",
  "review_actor_type",
  "operator_note",
  "phone_verification_status",
  "proxy_wallet_id",
  "proxy_wallet_address",
  "onchain_network",
  "onchain_chain_id",
  "onchain_mint_status",
  "onchain_tx_hash",
  "onchain_token_id",
  "onchain_minted_at",
  "ai_priority",
  "ai_triage_at",
  "ai_triage_rationale",
  "ai_triage_confidence",
  "dedupe_hash",
  "created_at",
].join(",");

const LEGACY_REPORT_COLUMNS = [
  "id",
  "source_app",
  "source_channel",
  "category",
  "description",
  "longitude",
  "latitude",
  "photo_url",
  "confidence",
  "verification_status",
  "moderation_status",
  "confirmations",
  "reviewed_by",
  "reviewed_at",
  "review_actor_type",
  "operator_note",
  "metadata",
  "created_at",
].join(",");

const REPORT_COLUMNS_WITHOUT_AI = [
  "id",
  "report_message_id",
  "source_app",
  "source_channel",
  "category",
  "description",
  "longitude",
  "latitude",
  "photo_url",
  "confidence",
  "verification_status",
  "moderation_status",
  "confirmations",
  "reviewed_by",
  "reviewed_at",
  "review_actor_type",
  "operator_note",
  "phone_verification_status",
  "proxy_wallet_id",
  "proxy_wallet_address",
  "onchain_network",
  "onchain_chain_id",
  "onchain_mint_status",
  "onchain_tx_hash",
  "onchain_token_id",
  "onchain_minted_at",
  "created_at",
].join(",");

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || (!serviceKey && !anonKey)) return null;
  return {
    url: url.replace(/\/$/, ""),
    serviceKey,
    anonKey,
  };
}

export function supabaseReportsEnabled() {
  return supabaseConfig() !== null;
}

export function supabaseServiceRoleEnabled() {
  const cfg = supabaseConfig();
  return cfg !== null && decodeJwtRole(cfg.serviceKey) === "service_role";
}

function headers(serviceKey: string) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

export async function listSupabaseReports(): Promise<PublicReport[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];

  const readKeys = [cfg.anonKey, cfg.serviceKey].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const triedKeys = new Set<string>();
  let res: Response | null = null;

  for (const key of readKeys) {
    if (triedKeys.has(key)) continue;
    triedKeys.add(key);

    res = await fetchReportsWithColumns(cfg.url, key, REPORT_COLUMNS);

    if (!res.ok && isMissingOnchainSchema(await cloneErrorText(res))) {
      res = await fetchReportsWithColumns(cfg.url, key, LEGACY_REPORT_COLUMNS);
    }

    if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
      res = await fetchReportsWithColumns(cfg.url, key, REPORT_COLUMNS_WITHOUT_AI);
    }

    if (res.ok) break;
  }

  if (!res?.ok) {
    throw new Error(`Supabase reports ${res?.status ?? "no_response"}`);
  }

  const rows = (await res.json()) as SupabaseReportRow[];
  return rows.map(toPublicReport);
}

export async function createSupabaseReport(
  input: ReportInsert,
): Promise<PublicReport> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) throw new Error("Supabase service-role writes are not configured.");

  const [longitude, latitude] = input.position;
  const reportMessageId = createReportMessageId();
  const dedupeHash = await computeDedupeHash({
    category: input.category,
    description: input.description,
    position: input.position,
  });
  const insertPayload = {
    report_message_id: reportMessageId,
    source_app: input.sourceApp ?? "aeris-dashboard",
    source_channel: input.sourceChannel ?? "dashboard_panel",
    category: input.category,
    description: input.description,
    longitude,
    latitude,
    location_accuracy_m: input.locationAccuracyM ?? null,
    photo_url: input.photoUrl ?? null,
    confidence: 0.35,
    verification_status: "unverified",
    moderation_status: "visible",
    confirmations: 0,
    ip_hash: input.ipHash,
    phone_verification_status: "unverified",
    onchain_network: "base-mainnet",
    onchain_chain_id: 8453,
    onchain_mint_status: "not_started",
    ai_priority: "pending",
    dedupe_hash: dedupeHash,
    metadata: {
      ...input.metadata,
      messageId: reportMessageId,
      anonymousId: input.anonymousId ?? null,
      onchain: {
        gasless: true,
        network: "base-mainnet",
        chainId: 8453,
        mintAfter: "phone_verification",
      },
    },
  };

  let res = await fetch(`${cfg.url}/rest/v1/disaster_reports?select=${REPORT_COLUMNS}`, {
    method: "POST",
    headers: {
      ...headers(cfg.serviceKey),
      prefer: "return=representation",
    },
    body: JSON.stringify(insertPayload),
  });

  if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
    const { ai_priority, dedupe_hash, ...withoutAi } = insertPayload as Record<string, unknown>;
    res = await fetch(`${cfg.url}/rest/v1/disaster_reports?select=${REPORT_COLUMNS_WITHOUT_AI}`, {
      method: "POST",
      headers: {
        ...headers(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(withoutAi),
    });
  }

  if (!res.ok && isMissingOnchainSchema(await cloneErrorText(res))) {
    res = await fetch(`${cfg.url}/rest/v1/disaster_reports?select=${LEGACY_REPORT_COLUMNS}`, {
      method: "POST",
      headers: {
        ...headers(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(toLegacyInsertPayload(insertPayload)),
    });
  }

  if (!res.ok) {
    throw new Error(`Supabase report insert ${res.status}`);
  }

  const rows = (await res.json()) as SupabaseReportRow[];
  if (!rows[0]) throw new Error("Supabase returned no report.");
  return toPublicReport(rows[0]);
}

export async function reviewSupabaseReport(
  input: ReportReviewInput,
): Promise<PublicReport> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) throw new Error("Supabase service-role writes are not configured.");
  const writeCfg = { url: cfg.url, serviceKey: cfg.serviceKey };
  if (decodeJwtRole(writeCfg.serviceKey) !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be a service_role JWT for report reviews.");
  }

  const current = await getSupabaseReportRow(writeCfg, input.reportId);
  const next = nextReviewState(current, input);
  const reviewedAt = new Date().toISOString();

  const updatePayload = {
    verification_status: next.verificationStatus,
    moderation_status: next.moderationStatus,
    confidence: next.confidence,
    reviewed_by: input.actorId ?? input.actorType,
    reviewed_at: reviewedAt,
    review_actor_type: input.actorType,
    operator_note: input.note ?? current.operator_note,
  };

  const updateRes = await fetch(
    `${writeCfg.url}/rest/v1/disaster_reports?id=eq.${encodeURIComponent(input.reportId)}&select=${REPORT_COLUMNS}`,
    {
      method: "PATCH",
      headers: {
        ...headers(writeCfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(updatePayload),
    },
  );

  if (!updateRes.ok) {
    throw new Error(`Supabase report review ${updateRes.status}`);
  }

  const rows = (await updateRes.json()) as SupabaseReportRow[];
  if (!rows[0]) throw new Error("Supabase returned no reviewed report.");

  await insertReviewEvent(writeCfg, current, rows[0], input);

  // Phase 6.4 - queue for on-chain mint when both gates are satisfied:
  //   verification_status === 'verified' (operator review)
  //   phone_verification_status === 'verified' (citizen owns the phone)
  // We only transition queued from a non-terminal mint state to avoid
  // re-queueing already-minted reports.
  if (
    rows[0].verification_status === "verified" &&
    rows[0].phone_verification_status === "verified"
  ) {
    const currentMint = rows[0].onchain_mint_status ?? "not_started";
    if (
      currentMint === "not_started" ||
      currentMint === "pending_phone" ||
      currentMint === "pending_review"
    ) {
      await fetch(
        `${writeCfg.url}/rest/v1/disaster_reports?id=eq.${encodeURIComponent(input.reportId)}`,
        {
          method: "PATCH",
          headers: { ...headers(writeCfg.serviceKey), prefer: "return=minimal" },
          body: JSON.stringify({ onchain_mint_status: "queued" }),
        },
      );
    }
  }

  return toPublicReport(rows[0]);
}

export async function getSupabaseReportById(reportId: string): Promise<PublicReport | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;
  try {
    const row = await getSupabaseReportRow({ url: cfg.url, serviceKey: cfg.serviceKey }, reportId);
    return toPublicReport(row);
  } catch {
    return null;
  }
}

export async function listPendingTriageReports(limit = 25): Promise<PublicReport[]> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return [];

  const params = new URLSearchParams({
    select: REPORT_COLUMNS,
    ai_priority: "eq.pending",
    order: "created_at.asc",
    limit: String(limit),
  });

  let res = await fetch(`${cfg.url}/rest/v1/disaster_reports?${params}`, {
    headers: headers(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
    return [];
  }

  if (!res.ok) throw new Error(`Supabase pending triage list ${res.status}`);
  const rows = (await res.json()) as SupabaseReportRow[];
  return rows.map(toPublicReport);
}

export async function findDuplicateReport(
  dedupeHash: string,
  excludeReportId: string,
  withinHours = 6,
): Promise<PublicReport | null> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return null;

  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    select: REPORT_COLUMNS,
    dedupe_hash: `eq.${dedupeHash}`,
    id: `neq.${excludeReportId}`,
    created_at: `gte.${since}`,
    order: "created_at.asc",
    limit: "1",
  });

  let res = await fetch(`${cfg.url}/rest/v1/disaster_reports?${params}`, {
    headers: headers(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
    return null;
  }

  if (!res.ok) return null;
  const rows = (await res.json()) as SupabaseReportRow[];
  return rows[0] ? toPublicReport(rows[0]) : null;
}

export async function patchAiTriageFields(
  reportId: string,
  fields: {
    aiPriority: AiPriority;
    aiTriageAt: string;
    aiTriageRationale: string;
    aiTriageConfidence: number;
    dedupeHash: string;
  },
): Promise<void> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) throw new Error("Supabase service-role writes are not configured.");

  const res = await fetch(
    `${cfg.url}/rest/v1/disaster_reports?id=eq.${encodeURIComponent(reportId)}`,
    {
      method: "PATCH",
      headers: headers(cfg.serviceKey),
      body: JSON.stringify({
        ai_priority: fields.aiPriority,
        ai_triage_at: fields.aiTriageAt,
        ai_triage_rationale: fields.aiTriageRationale,
        ai_triage_confidence: fields.aiTriageConfidence,
        dedupe_hash: fields.dedupeHash,
      }),
    },
  );

  if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
    return;
  }

  if (!res.ok) {
    throw new Error(`Supabase ai triage patch ${res.status}`);
  }
}

export async function listSupabaseReportsByAnonymousId(
  anonymousId: string,
): Promise<PublicReport[]> {
  const cfg = supabaseConfig();
  if (!cfg?.serviceKey) return [];

  const params = new URLSearchParams({
    select: REPORT_COLUMNS,
    metadata: `cs.{"anonymousId":"${anonymousId}"}`,
    order: "created_at.desc",
    limit: "100",
  });

  let res = await fetch(`${cfg.url}/rest/v1/disaster_reports?${params}`, {
    headers: headers(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok && isMissingAiSchema(await cloneErrorText(res))) {
    res = await fetch(
      `${cfg.url}/rest/v1/disaster_reports?${new URLSearchParams({
        select: REPORT_COLUMNS_WITHOUT_AI,
        metadata: `cs.{"anonymousId":"${anonymousId}"}`,
        order: "created_at.desc",
        limit: "100",
      })}`,
      { headers: headers(cfg.serviceKey), cache: "no-store" },
    );
  }

  if (!res.ok) return [];
  const rows = (await res.json()) as SupabaseReportRow[];
  return rows.map(toPublicReport);
}

function toPublicReport(row: SupabaseReportRow): PublicReport {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const metadataOnchain =
    metadata.onchain && typeof metadata.onchain === "object"
      ? (metadata.onchain as Record<string, unknown>)
      : {};
  const messageId =
    row.report_message_id ?? (typeof metadata.messageId === "string" ? metadata.messageId : undefined);

  return {
    id: row.id,
    messageId,
    category: row.category,
    description: row.description,
    position: [Number(row.longitude), Number(row.latitude)],
    photoUrl: row.photo_url ?? undefined,
    createdAt: row.created_at,
    confirmations: row.confirmations ?? 0,
    sourceApp: row.source_app ?? undefined,
    sourceChannel: row.source_channel ?? undefined,
    confidence: row.confidence ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    moderationStatus: row.moderation_status ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewActorType: row.review_actor_type ?? undefined,
    operatorNote: row.operator_note ?? undefined,
    phoneVerificationStatus: row.phone_verification_status ?? undefined,
    aiPriority: (row.ai_priority as AiPriority | null) ?? undefined,
    aiTriageAt: row.ai_triage_at ?? undefined,
    aiTriageRationale: row.ai_triage_rationale ?? undefined,
    aiTriageConfidence: row.ai_triage_confidence ?? undefined,
    dedupeHash: row.dedupe_hash ?? undefined,
    sessionId:
      typeof metadata.sessionId === "string" && metadata.sessionId.length > 0
        ? (metadata.sessionId as string)
        : undefined,
    anonymousId:
      typeof metadata.anonymousId === "string" && metadata.anonymousId.length > 0
        ? (metadata.anonymousId as string)
        : undefined,
    metadata: metadata as Record<string, unknown>,
    onchain: {
      proxyWallet: row.proxy_wallet_id || row.proxy_wallet_address
        ? {
            id: row.proxy_wallet_id ?? undefined,
            address: row.proxy_wallet_address ?? undefined,
            network: row.onchain_network ?? "base-mainnet",
            chainId: row.onchain_chain_id ?? 8453,
          }
        : undefined,
      mint: {
        network:
          row.onchain_network ??
          (typeof metadataOnchain.network === "string" ? metadataOnchain.network : "base-mainnet"),
        chainId:
          row.onchain_chain_id ??
          (typeof metadataOnchain.chainId === "number" ? metadataOnchain.chainId : 8453),
        status: row.onchain_mint_status ?? "not_started",
        txHash: row.onchain_tx_hash ?? undefined,
        tokenId: row.onchain_token_id ?? undefined,
        mintedAt: row.onchain_minted_at ?? undefined,
      },
    },
  };
}

function fetchReportsWithColumns(url: string, key: string, columns: string) {
  const params = new URLSearchParams({
    select: columns,
    moderation_status: "neq.hidden",
    verification_status: "neq.rejected",
    order: "created_at.desc",
    limit: "500",
  });

  return fetch(`${url}/rest/v1/disaster_reports?${params}`, {
    headers: headers(key),
    cache: "no-store",
  });
}

async function getSupabaseReportRow(
  cfg: { url: string; serviceKey: string },
  reportId: string,
) {
  const params = new URLSearchParams({
    select: REPORT_COLUMNS,
    id: `eq.${reportId}`,
    limit: "1",
  });
  const res = await fetch(`${cfg.url}/rest/v1/disaster_reports?${params}`, {
    headers: headers(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Supabase report lookup ${res.status}`);
  const rows = (await res.json()) as SupabaseReportRow[];
  if (!rows[0]) throw new Error("Report not found.");
  return rows[0];
}

function nextReviewState(row: SupabaseReportRow, input: ReportReviewInput) {
  const confidence = clampConfidence(input.confidence ?? row.confidence ?? 0.25);
  switch (input.action) {
    case "verify":
      return {
        verificationStatus: "verified",
        moderationStatus: "visible",
        confidence: Math.max(confidence, 0.8),
      };
    case "reject":
      return {
        verificationStatus: "rejected",
        moderationStatus: "hidden",
        confidence: Math.min(confidence, 0.1),
      };
    case "duplicate":
      return {
        verificationStatus: "duplicate",
        moderationStatus: "hidden",
        confidence: Math.min(confidence, 0.3),
      };
    case "hide":
      return {
        verificationStatus: row.verification_status ?? "unverified",
        moderationStatus: "hidden",
        confidence,
      };
    case "unhide":
      return {
        verificationStatus: row.verification_status ?? "unverified",
        moderationStatus: "visible",
        confidence,
      };
    case "needs_review":
      return {
        verificationStatus: "pending",
        moderationStatus: "needs_review",
        confidence,
      };
    case "unverify":
      return {
        verificationStatus: "unverified",
        moderationStatus: "visible",
        confidence: Math.min(confidence, 0.5),
      };
    case "confidence_adjust":
      return {
        verificationStatus: row.verification_status ?? "unverified",
        moderationStatus: row.moderation_status ?? "visible",
        confidence,
      };
    case "note":
    default:
      return {
        verificationStatus: row.verification_status ?? "unverified",
        moderationStatus: row.moderation_status ?? "visible",
        confidence,
      };
  }
}

async function insertReviewEvent(
  cfg: { url: string; serviceKey: string },
  before: SupabaseReportRow,
  after: SupabaseReportRow,
  input: ReportReviewInput,
) {
  const res = await fetch(`${cfg.url}/rest/v1/report_review_events`, {
    method: "POST",
    headers: headers(cfg.serviceKey),
    body: JSON.stringify({
      report_id: input.reportId,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      action: input.action,
      previous_verification_status: before.verification_status,
      new_verification_status: after.verification_status,
      previous_moderation_status: before.moderation_status,
      new_moderation_status: after.moderation_status,
      confidence_before: before.confidence,
      confidence_after: after.confidence,
      note: input.note ?? null,
      metadata: input.metadata ?? {},
    }),
  });

  if (!res.ok) {
    throw new Error(`Supabase review event insert ${res.status}`);
  }
}

function toLegacyInsertPayload(payload: Record<string, unknown>) {
  const {
    report_message_id,
    phone_verification_status,
    proxy_wallet_id,
    proxy_wallet_address,
    onchain_network,
    onchain_chain_id,
    onchain_mint_status,
    onchain_tx_hash,
    onchain_token_id,
    onchain_minted_at,
    ...legacyPayload
  } = payload;

  return legacyPayload;
}

function isMissingAiSchema(message: string) {
  return /ai_priority|ai_triage|dedupe_hash|schema cache/i.test(message);
}

function isMissingOnchainSchema(message: string) {
  return /report_message_id|phone_verification_status|proxy_wallet|onchain_|schema cache/i.test(
    message,
  );
}

async function cloneErrorText(response: Response) {
  return response.clone().text().catch(() => "");
}

function createReportMessageId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `AERIS-${timestamp}-${random}`;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.25;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

function decodeJwtRole(token?: string | null) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      role?: unknown;
    };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

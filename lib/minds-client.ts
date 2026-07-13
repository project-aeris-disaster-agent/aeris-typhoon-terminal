import {
  createMindsClient,
  MindsApiError,
  type BuilderMind,
  type CognitionBalance,
  type CognitionUsageByToolResponse,
  type MindsClient,
  type SendMessageBody,
} from "@animocabrands/minds-client-lib";
import {
  getMindsAerisMindId,
  getMindsBuilderApiKey,
  getMindsCognitionWarnThreshold,
  getMindsReplyTimeoutMs,
  getMindsWatchAlias,
} from "@/lib/minds-config";

export { MindsApiError };

let cachedClient: MindsClient | null = null;

export function mindsClientAvailable(): boolean {
  return Boolean(getMindsBuilderApiKey() && getMindsAerisMindId());
}

export function getMindsClient(): MindsClient {
  const builderApiKey = getMindsBuilderApiKey();
  if (!builderApiKey) {
    throw new Error("MINDS_BUILDER_API_KEY is not configured.");
  }

  if (!cachedClient) {
    cachedClient = createMindsClient({ builderApiKey });
  }
  return cachedClient;
}

/** Reset singleton — for tests only. */
export function resetMindsClientForTests(): void {
  cachedClient = null;
}

export function describeMindsApiError(error: unknown): string {
  if (error instanceof MindsApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Minds Builder API key is missing, invalid, or revoked.";
    }
    if (error.status === 429) {
      return "Minds Builder API rate limit exceeded.";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown Minds API error.";
}

export async function ensureWatchConversation(
  alias: string,
  mindId: string,
): Promise<void> {
  const client = getMindsClient();
  await client.ensureConversation(alias, mindId);
}

export type WatchMessageAttachment = NonNullable<SendMessageBody["attachments"]>[number];

export async function sendWatchMessage(input: {
  alias?: string;
  messageText: string;
  attachments?: WatchMessageAttachment[];
}): Promise<{ fingerprint?: string }> {
  const client = getMindsClient();
  const alias = input.alias ?? getMindsWatchAlias();
  const mindId = getMindsAerisMindId();
  if (!mindId) {
    throw new Error("MINDS_AERIS_MIND_ID is not configured.");
  }

  await client.ensureConversation(alias, mindId);

  const response = await client.sendMessage({
    alias,
    messageText: input.messageText,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  });

  const fingerprint =
    typeof response.fingerprint === "string" ? response.fingerprint : undefined;
  return { fingerprint };
}

export interface WatchMessageDeliveryResult {
  fingerprint?: string;
  /** True when the Mind replied within the bounded timeout. */
  confirmed: boolean;
  replyText?: string;
}

/**
 * Send a message and wait (bounded) for the Mind's reply. Used for critical
 * alerts (SOS/breaking) where fire-and-forget is not enough. A timeout is not
 * an error — the message was still delivered; `confirmed` is just false.
 */
export async function sendWatchMessageConfirmed(input: {
  alias?: string;
  messageText: string;
  attachments?: WatchMessageAttachment[];
  timeoutMs?: number;
}): Promise<WatchMessageDeliveryResult> {
  const alias = input.alias ?? getMindsWatchAlias();
  const { fingerprint } = await sendWatchMessage({ ...input, alias });

  const client = getMindsClient();
  const outcome = await client.waitForReply({
    alias,
    timeoutMs: input.timeoutMs ?? getMindsReplyTimeoutMs(),
    sentMessageText: input.messageText,
    ...(fingerprint ? { afterFingerprint: fingerprint } : {}),
  });

  if (outcome.timedOut) {
    return { fingerprint, confirmed: false };
  }
  const replyText =
    typeof outcome.reply.messageText === "string"
      ? outcome.reply.messageText
      : undefined;
  return { fingerprint, confirmed: true, replyText };
}

function requireMindId(mindId?: string): string {
  const id = mindId ?? getMindsAerisMindId();
  if (!id) throw new Error("MINDS_AERIS_MIND_ID is not configured.");
  return id;
}

export async function getMindDetails(mindId?: string): Promise<BuilderMind> {
  return getMindsClient().getMind(requireMindId(mindId));
}

export async function setMindEnabled(
  enabled: boolean,
  mindId?: string,
): Promise<BuilderMind> {
  return getMindsClient().updateMindStatus(requireMindId(mindId), {
    isEnabled: enabled,
  });
}

export interface CognitionStatus {
  balance: CognitionBalance;
  warnThreshold: number;
  low: boolean;
}

export async function getCognitionStatus(
  mindId?: string,
): Promise<CognitionStatus> {
  const balance = await getMindsClient().getCognitionBalance(
    requireMindId(mindId),
  );
  const warnThreshold = getMindsCognitionWarnThreshold();
  return { balance, warnThreshold, low: balance.cognition < warnThreshold };
}

export async function getCognitionUsageByTool(
  mindId?: string,
  interval: "hour" | "day" | "week" | "month" = "day",
): Promise<CognitionUsageByToolResponse> {
  return getMindsClient().getCognitionUsageByTool(requireMindId(mindId), {
    interval,
  });
}

import {
  createMindsClient,
  MindsApiError,
  type MindsClient,
  type SendMessageBody,
} from "@animocabrands/minds-client-lib";
import {
  getMindsAerisMindId,
  getMindsBuilderApiKey,
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

/**
 * Per-user "First-Responder partner" conversations (server-only).
 *
 * The Minds Builder API cannot create Minds programmatically, so each user
 * gets their own persistent conversation thread (alias) on a shared role
 * Mind instead: volunteers, first responders, and LGU staff map to role
 * Minds provisioned manually at hellominds.ai (each falling back to the
 * Watch Officer Mind until provisioned). The alias carries the per-user
 * memory/history, so the partner keeps context across sessions.
 */

import {
  describeMindsApiError,
  getMindsClient,
  mindsClientAvailable,
} from "@/lib/minds-client";
import {
  getMindsRoleMindId,
  type AerisUserRole,
} from "@/lib/minds-config";

const ALIAS_PREFIX = "aeris-user-";

/** Stable per-user conversation alias. Privy DIDs contain ':' — normalize. */
export function userPartnerAlias(userId: string): string {
  const normalized = userId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${ALIAS_PREFIX}${normalized}`;
}

export type UserPartnerConversation = {
  alias: string;
  mindId: string;
  role: AerisUserRole;
};

/**
 * Ensure the user's partner conversation exists on the role Mind.
 * Idempotent — safe to call on every session start.
 */
export async function ensureUserPartnerConversation(input: {
  userId: string;
  role?: AerisUserRole;
}): Promise<UserPartnerConversation | null> {
  if (!mindsClientAvailable()) return null;

  const role = input.role ?? "volunteer";
  const mindId = getMindsRoleMindId(role);
  if (!mindId) return null;

  const alias = userPartnerAlias(input.userId);
  try {
    await getMindsClient().ensureConversation(alias, mindId);
    return { alias, mindId, role };
  } catch (error) {
    console.error(
      `[minds-partner] ensureConversation failed for ${alias}: ${describeMindsApiError(error)}`,
    );
    return null;
  }
}

/**
 * Send a message into the user's partner thread and (optionally) wait for
 * the Mind's reply. Returns null when Minds is unavailable or errors — the
 * caller decides how to degrade.
 */
export async function sendUserPartnerMessage(input: {
  userId: string;
  role?: AerisUserRole;
  messageText: string;
  waitForReplyMs?: number;
}): Promise<{ alias: string; replyText?: string } | null> {
  const conversation = await ensureUserPartnerConversation(input);
  if (!conversation) return null;

  const client = getMindsClient();
  try {
    const response = await client.sendMessage({
      alias: conversation.alias,
      messageText: input.messageText,
    });

    if (!input.waitForReplyMs || input.waitForReplyMs < 1_000) {
      return { alias: conversation.alias };
    }

    const fingerprint =
      typeof response.fingerprint === "string" ? response.fingerprint : undefined;
    const outcome = await client.waitForReply({
      alias: conversation.alias,
      timeoutMs: input.waitForReplyMs,
      sentMessageText: input.messageText,
      ...(fingerprint ? { afterFingerprint: fingerprint } : {}),
    });

    if (outcome.timedOut) return { alias: conversation.alias };
    return {
      alias: conversation.alias,
      replyText:
        typeof outcome.reply.messageText === "string"
          ? outcome.reply.messageText
          : undefined,
    };
  } catch (error) {
    console.error(
      `[minds-partner] send failed for ${conversation.alias}: ${describeMindsApiError(error)}`,
    );
    return null;
  }
}

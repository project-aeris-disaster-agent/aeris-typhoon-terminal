import { NextRequest } from "next/server";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { authorizeMindsApiRequest } from "@/lib/minds-auth";
import {
  describeMindsApiError,
  getMindsClient,
  mindsClientAvailable,
} from "@/lib/minds-client";
import { getMindsWatchAlias } from "@/lib/minds-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_LIMIT = 50;

/**
 * Recent Watch Officer conversation history (inbound Mind → dashboard
 * channel). Lets operator tooling surface what the Mind has said/done
 * without opening hellominds.ai. Auth mirrors the snapshot route.
 */
export async function GET(request: NextRequest) {
  if (!authorizeMindsApiRequest(request)) {
    return jsonError("Unauthorized.", 401);
  }
  if (!mindsClientAvailable()) {
    return jsonError("Minds is not configured.", 503);
  }

  const params = request.nextUrl.searchParams;
  const alias = params.get("alias")?.trim() || getMindsWatchAlias();
  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : 20;

  try {
    const history = await getMindsClient().getHistory(alias, { limit });
    return jsonOkNoStore({
      alias,
      messages: history.map((record) => ({
        fingerprint: record.fingerprint,
        messageId: record.messageId,
        messageText: record.messageText ?? null,
        createdAt: record.createdAt,
        partyId: record.partyId ?? null,
      })),
    });
  } catch (error) {
    console.error(`[minds-activity] ${describeMindsApiError(error)}`);
    return jsonError("Unable to fetch Mind activity.", 502);
  }
}

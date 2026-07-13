import { NextRequest } from "next/server";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { authorizeMindsApiRequest } from "@/lib/minds-auth";
import {
  describeMindsApiError,
  getCognitionStatus,
  getMindDetails,
  mindsClientAvailable,
} from "@/lib/minds-client";
import { isMindsNotifyEnabled } from "@/lib/minds-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Authorized Mind health/cognition status. Lives behind MINDS_API_SECRET
 * (not /api/health) so unauthenticated hits can't trigger external API spend.
 */
export async function GET(request: NextRequest) {
  if (!authorizeMindsApiRequest(request)) {
    return jsonError("Unauthorized.", 401);
  }

  if (!mindsClientAvailable()) {
    return jsonOkNoStore({
      notifyEnabled: isMindsNotifyEnabled(),
      configured: false,
      warnings: ["MINDS_BUILDER_API_KEY or MINDS_AERIS_MIND_ID is missing."],
    });
  }

  try {
    const [mind, cognition] = await Promise.all([
      getMindDetails(),
      getCognitionStatus(),
    ]);

    const warnings: string[] = [];
    if (cognition.low) {
      warnings.push(
        `Cognition balance ${cognition.balance.cognition} is below warn threshold ${cognition.warnThreshold}.`,
      );
    }
    if (mind.isEnabled === false) {
      warnings.push("Mind is currently disabled.");
    }

    return jsonOkNoStore({
      notifyEnabled: isMindsNotifyEnabled(),
      configured: true,
      mind: {
        mindId: mind.mindId,
        name: mind.name,
        isEnabled: mind.isEnabled,
      },
      cognition: {
        balance: cognition.balance.cognition,
        warnThreshold: cognition.warnThreshold,
        low: cognition.low,
      },
      warnings,
    });
  } catch (error) {
    console.error(`[minds-status] ${describeMindsApiError(error)}`);
    return jsonError("Unable to fetch Mind status.", 502);
  }
}

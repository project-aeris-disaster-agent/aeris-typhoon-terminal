import { NextRequest } from "next/server";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import {
  buildAgentLiveContext,
  type AgentSelectedLocationHint,
} from "@/lib/agent-context";
import { authorizeMindsApiRequest } from "@/lib/minds-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseCoordinate(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function locationHintFromSearchParams(
  searchParams: URLSearchParams,
): AgentSelectedLocationHint | null {
  const lat = parseCoordinate(searchParams.get("lat"));
  const lon = parseCoordinate(searchParams.get("lon"));
  const name = searchParams.get("name")?.trim();

  if (lat === undefined && lon === undefined && !name) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
  };
}

export async function GET(request: NextRequest) {
  if (!authorizeMindsApiRequest(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const locationHint = locationHintFromSearchParams(request.nextUrl.searchParams);

  try {
    const context = await buildAgentLiveContext(locationHint);
    return jsonOkNoStore(context);
  } catch (error) {
    console.error(
      `[minds-snapshot] buildAgentLiveContext failed: ${(error as Error).message}`,
    );
    return jsonError("Unable to build live context snapshot.", 500);
  }
}

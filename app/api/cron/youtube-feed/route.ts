import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { refreshMonitoredYoutubeChannels } from "@/lib/youtube-feed/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorizeCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  return false;
}

/** Daily safety-net refresh for all monitored YouTube channels (Hobby cron). */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const result = await refreshMonitoredYoutubeChannels();
  return jsonOkNoStore({
    ok: true,
    videoCount: result.videos.length,
    errors: result.errors,
    checkedAt: new Date().toISOString(),
  });
}

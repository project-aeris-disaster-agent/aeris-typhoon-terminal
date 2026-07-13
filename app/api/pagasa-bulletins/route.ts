import { jsonOkNoStore } from "@/lib/api-response";
import { fetchPagasaBulletins } from "@/lib/pagasa-bulletins";
import { filterStaleBulletins } from "@/lib/pagasa-bulletin-staleness";
import {
  listStormWatchCycles,
  stormWatchStateEnabled,
} from "@/lib/storm-watch/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const data = await fetchPagasaBulletins({ bypassCache: refresh });
  if (!data) {
    return jsonOkNoStore({ ok: false, pagasaBulletins: null });
  }

  // Backup when the SWB quiet-PAR probe failed: hide dissipated systems the
  // parser still lists as non-final, using storm-watch cycle history. Fail open
  // so a genuinely active bulletin is never withheld.
  let pagasaBulletins = data;
  if (!data.quiet && stormWatchStateEnabled()) {
    try {
      const cycles = await listStormWatchCycles();
      pagasaBulletins = filterStaleBulletins(data, cycles);
    } catch {
      pagasaBulletins = data;
    }
  }

  return jsonOkNoStore({ ok: true, pagasaBulletins });
}

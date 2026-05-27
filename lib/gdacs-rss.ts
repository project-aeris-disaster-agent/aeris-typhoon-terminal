import { fetchUpstream } from "@/lib/fetch-upstream";

/** GDACS blocks some edge/datacenter fetches — use Node.js routes for RSS. */
export const GDACS_RSS_URL = "https://www.gdacs.org/xml/rss.xml";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function gdacsFetchHeaders(accept = "application/xml,text/xml;q=0.9,*/*;q=0.8") {
  return {
    accept,
    "accept-language": "en-US,en;q=0.9",
    "user-agent": BROWSER_UA,
    referer: "https://www.gdacs.org/",
  };
}

export async function fetchGdacsRssXml(revalidateSeconds = 300): Promise<string> {
  const headers = gdacsFetchHeaders();
  const res = await fetchUpstream(GDACS_RSS_URL, {
    next: { revalidate: revalidateSeconds },
    headers,
  });
  if (res.status === 406) {
    const retry = await fetchUpstream(GDACS_RSS_URL, {
      next: { revalidate: revalidateSeconds },
      headers: gdacsFetchHeaders("application/xml"),
    });
    if (!retry.ok) throw new Error(`GDACS RSS ${retry.status}`);
    return retry.text();
  }
  if (!res.ok) throw new Error(`GDACS RSS ${res.status}`);
  return res.text();
}

export function firstRssMatch(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

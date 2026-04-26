import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, cacheSeconds = 60): NextResponse {
  return NextResponse.json(data, {
    status: 200,
    headers: {
      "cache-control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 6}`,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

/** JSON for endpoints where intermediaries must not cache (live feeds, etc.). */
export function jsonOkNoStore<T>(data: T): NextResponse {
  return NextResponse.json(data, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: message, ...extra },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

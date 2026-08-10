import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { lookupAerisRoleByUserId } from "@/lib/aeris-role-lookup";
import { isDashboardAuthDisabled, productionAuthMisconfigured } from "@/lib/auth-config";
import { isPublicPath, isStaticAssetPath } from "@/lib/middleware-paths";
import { isMobileUserAgent } from "@/lib/mobile-access";
import { verifyPrivyAccessToken } from "@/lib/privy-server";
import { safePostLoginPath } from "@/lib/safe-redirect";

const PRIVY_OAUTH_PARAMS = ["privy_oauth_code", "privy_oauth_state", "privy_oauth_provider"];

function misconfiguredResponse(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Dashboard auth is not configured for production." },
      { status: 503 },
    );
  }
  return new NextResponse("Dashboard auth is not configured for production.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function hasPrivyOAuthParam(request: NextRequest) {
  return PRIVY_OAUTH_PARAMS.some((param) => request.nextUrl.searchParams.has(param));
}

function isMobileAccessExemptApi(pathname: string) {
  return (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/user/sync")
  );
}

async function blockMobileNonAdminApi(
  request: NextRequest,
  userId: string,
): Promise<NextResponse | null> {
  if (!isMobileUserAgent(request.headers.get("user-agent"))) return null;
  if (!request.nextUrl.pathname.startsWith("/api/")) return null;
  if (isMobileAccessExemptApi(request.nextUrl.pathname)) return null;

  const role = await lookupAerisRoleByUserId(userId);
  if (role === "admin") return null;

  return NextResponse.json(
    { error: "This application is best used on desktop. Visit bagyo.app on mobile." },
    { status: 403 },
  );
}

async function getSupabaseUserId(request: NextRequest): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function middleware(request: NextRequest) {
  // Via the helper, not the raw env var: the helper refuses to honour the flag
  // on a production deploy. Reading process.env directly here is what let a
  // single misset variable disable the gate in production.
  if (isDashboardAuthDisabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || isStaticAssetPath(pathname)) {
    return NextResponse.next();
  }

  if (productionAuthMisconfigured()) {
    return misconfiguredResponse(pathname);
  }

  if (hasPrivyOAuthParam(request)) {
    return NextResponse.next();
  }

  const privyToken = request.cookies.get("privy-token")?.value;
  const privySession = request.cookies.get("privy-session")?.value;

  if (privyToken) {
    const verified = await verifyPrivyAccessToken(privyToken);
    if (verified) {
      const mobileBlock = await blockMobileNonAdminApi(request, verified.userId);
      if (mobileBlock) return mobileBlock;

      return NextResponse.next({ request: { headers: request.headers } });
    }
  }

  if (!privyToken && privySession) {
    const refreshUrl = request.nextUrl.clone();
    refreshUrl.pathname = "/refresh";
    refreshUrl.searchParams.set("redirect_url", safePostLoginPath(pathname));
    return NextResponse.redirect(refreshUrl);
  }

  const supabaseUserId = await getSupabaseUserId(request);
  if (supabaseUserId) {
    const mobileBlock = await blockMobileNonAdminApi(request, supabaseUserId);
    if (mobileBlock) return mobileBlock;

    return NextResponse.next({ request: { headers: request.headers } });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", safePostLoginPath(pathname));
  return NextResponse.redirect(loginUrl);
}

/**
 * Keep middleware off the static asset paths entirely. It is a 167 kB edge
 * bundle that verifies a Privy JWT (remote JWKS) and may hit Supabase, so
 * every megabyte of hazard GeoJSON, DEM tile, and VRM model that reaches it
 * costs latency for nothing.
 *
 * Excluding a directory here is also strictly safer than exempting it inside
 * the handler: these are literal path prefixes, not extension suffixes, so a
 * route cannot back into the exemption by ending in the right characters.
 * A new asset directory that is not listed simply gets gated — it fails
 * closed, which is the correct direction for this control.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json|icon\\.svg|icon-\\d+\\.png|ph-outline\\.json|admin-boundaries/|ads/|assets/|dem/|flood-hazard/|hazards/|models/|osm-context/|textures/|vendor/).*)",
  ],
};

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { lookupAerisRoleByUserId } from "@/lib/aeris-role-lookup";
import { productionAuthMisconfigured } from "@/lib/auth-config";
import { isMobileUserAgent } from "@/lib/mobile-access";
import { verifyPrivyAccessToken } from "@/lib/privy-server";
import { safePostLoginPath } from "@/lib/safe-redirect";

const PUBLIC_PATHS = [
  "/login",
  "/refresh",
  "/api/auth",
  "/api/health",
  "/api/cron",
  "/api/internal",
  "/api/geocode",
  "/auth",
];

const PRIVY_OAUTH_PARAMS = ["privy_oauth_code", "privy_oauth_state", "privy_oauth_provider"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

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
  if (process.env.DASHBOARD_AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    isPublicPath(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".png")
  ) {
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

      const response = NextResponse.next({
        request: { headers: request.headers },
      });
      response.headers.set("x-aeris-user-id", verified.userId);
      return response;
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

    const response = NextResponse.next({
      request: { headers: request.headers },
    });
    response.headers.set("x-aeris-user-id", supabaseUserId);
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", safePostLoginPath(pathname));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

/** App routes that exist as pages (not API). Used to validate post-login redirects. */
const APP_PAGE_PATHS = new Set(["/"]);

/** Legacy or external deep links that should land on the dashboard home. */
const LEGACY_REDIRECTS: Record<string, string> = {
  "/chat": "/",
};

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//")) return "/";

  try {
    const url = new URL(trimmed, "http://local");
    return url.pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Privy OAuth verifies Cross-Origin-Opener-Policy on the post-login redirect
 * target. Unknown paths (e.g. /chat) return 404 and break Google sign-in.
 */
export function safePostLoginPath(path: string | null | undefined): string {
  const pathname = normalizePath(path ?? "/");

  if (pathname === "/login" || pathname === "/refresh") {
    return "/";
  }

  const legacyTarget = LEGACY_REDIRECTS[pathname];
  if (legacyTarget) return legacyTarget;

  if (APP_PAGE_PATHS.has(pathname)) {
    return pathname;
  }

  return "/";
}

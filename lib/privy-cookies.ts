/** Clear Privy session cookies so middleware stops redirecting to /refresh. */
export function clearPrivySessionCookies() {
  if (typeof document === "undefined") return;

  const names = ["privy-token", "privy-session", "privy-refresh-token", "privy-id-token"];
  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=${window.location.hostname}`;
  }
}

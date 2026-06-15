export function getPrivyAppId(): string | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  return appId || null;
}

export function isPrivyConfigured(): boolean {
  return Boolean(getPrivyAppId());
}

export function privyServerEnvMissing(): boolean {
  return !getPrivyAppId() || !process.env.PRIVY_APP_SECRET?.trim();
}

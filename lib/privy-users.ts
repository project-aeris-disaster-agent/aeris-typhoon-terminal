/**
 * Server-side Privy user lookup via the Privy REST API.
 *
 * Used at sync time to read the authoritative email + embedded ("proxy") wallet
 * address linked to a Privy DID, without trusting any client-supplied payload.
 */

import { getPrivyAppId } from "@/lib/privy-config";

export type PrivyUserInfo = {
  email: string | null;
  /** Embedded (Privy-managed) wallet address used as the proxy wallet. */
  walletAddress: string | null;
};

type PrivyLinkedAccount = {
  type?: string;
  address?: string;
  email?: string;
  wallet_client_type?: string;
  connector_type?: string;
};

/**
 * Fetch the linked email + embedded wallet for a Privy user. Returns null when
 * Privy server credentials are missing or the lookup fails (callers degrade
 * gracefully and backfill on a later sync).
 */
export async function fetchPrivyUserInfo(
  userId: string,
): Promise<PrivyUserInfo | null> {
  const appId = getPrivyAppId();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret || !userId) return null;

  try {
    const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const res = await fetch(
      `https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          authorization: `Basic ${basic}`,
          "privy-app-id": appId,
        },
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[privy-users] lookup failed ${res.status}: ${detail}`);
      return null;
    }

    const data = (await res.json()) as {
      linked_accounts?: PrivyLinkedAccount[];
    };
    const accounts = Array.isArray(data?.linked_accounts)
      ? data.linked_accounts
      : [];

    let email: string | null = null;
    let walletAddress: string | null = null;

    for (const acc of accounts) {
      if (!email) {
        if (acc.type === "email" && acc.address) email = acc.address;
        else if (acc.type === "google_oauth" && acc.email) email = acc.email;
      }
      if (
        !walletAddress &&
        acc.type === "wallet" &&
        acc.address &&
        (acc.wallet_client_type === "privy" || acc.connector_type === "embedded")
      ) {
        walletAddress = acc.address;
      }
    }

    // Fall back to any linked wallet if no embedded wallet exists yet.
    if (!walletAddress) {
      const anyWallet = accounts.find(
        (a) => a.type === "wallet" && a.address,
      );
      if (anyWallet?.address) walletAddress = anyWallet.address;
    }

    return { email, walletAddress };
  } catch (error) {
    console.error("[privy-users] lookup error", error);
    return null;
  }
}

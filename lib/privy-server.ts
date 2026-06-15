import { verifyAccessToken } from "@privy-io/node";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { getPrivyAppId } from "@/lib/privy-config";

let remoteJwks: JWTVerifyGetKey | null = null;

function getVerificationKey(): string | JWTVerifyGetKey | null {
  const appId = getPrivyAppId();
  if (!appId) return null;

  const verificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY?.trim();
  if (verificationKey) return verificationKey;

  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`),
    );
  }

  return remoteJwks;
}

export async function verifyPrivyAccessToken(
  accessToken: string,
): Promise<{ userId: string } | null> {
  const appId = getPrivyAppId();
  const verificationKey = getVerificationKey();
  if (!appId || !verificationKey) return null;

  try {
    const claims = await verifyAccessToken({
      access_token: accessToken,
      app_id: appId,
      verification_key: verificationKey,
    });
    return { userId: claims.user_id };
  } catch {
    return null;
  }
}

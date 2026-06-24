import { getMindsApiSecret } from "@/lib/minds-config";

export function authorizeMindsApiRequest(request: Request): boolean {
  const secret = getMindsApiSecret();
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get("x-minds-api-secret");
  return headerSecret === secret;
}

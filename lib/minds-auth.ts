import { requestPresentsSecret } from "@/lib/internal-auth";
import { getMindsApiSecret } from "@/lib/minds-config";

/** Minds routes carry their own secret so agent traffic can be revoked alone. */
export function authorizeMindsApiRequest(request: Request): boolean {
  return requestPresentsSecret(request, getMindsApiSecret(), "x-minds-api-secret");
}

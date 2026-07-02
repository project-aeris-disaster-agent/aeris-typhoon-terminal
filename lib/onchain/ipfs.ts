/**
 * Phase 6.3 - IPFS pinning helpers.
 *
 * Default backend is Pinata (set PINATA_JWT). Falls back to a "skip" mode in
 * dev that returns a synthetic ipfs://aeris-dev/<sha256> URI so the rest of
 * the mint pipeline can be exercised end-to-end without external services.
 */

import { createHash } from "node:crypto";

export type PinnedResult = {
  uri: string;
  cid: string;
  backend: "pinata" | "dev-skip";
};

export function ipfsPinningEnabled(): boolean {
  return Boolean(process.env.PINATA_JWT);
}

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // mirror Chat's 5 MB/file cap
const ALLOWED_EVIDENCE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Fetch + validate an http(s) evidence photo (e.g. a Supabase public URL),
 * enforcing the same mime/size limits Chat applies on upload. Raw evidence
 * photos are never pinned to IPFS or minted on-chain (see commitments.ts) -
 * this only returns bytes for hashing.
 */
export async function fetchEvidenceImageBytes(
  sourceUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("evidence image URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("evidence image URL must be http(s)");
  }

  const imgRes = await fetch(sourceUrl, { cache: "no-store" });
  if (!imgRes.ok) {
    throw new Error(`evidence image fetch failed (${imgRes.status})`);
  }
  const contentType = (imgRes.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType && !ALLOWED_EVIDENCE_MIME.has(contentType)) {
    throw new Error(`evidence image mime not allowed: ${contentType}`);
  }
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("evidence image is empty");
  }
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new Error(
      `evidence image too large: ${bytes.byteLength} > ${MAX_EVIDENCE_BYTES}`,
    );
  }

  return { bytes, contentType };
}

export async function pinJson(payload: unknown, name: string): Promise<PinnedResult> {
  const json = JSON.stringify(payload);
  if (!ipfsPinningEnabled()) {
    const cid = `bafkdev${createHash("sha256").update(json).digest("hex").slice(0, 50)}`;
    return { uri: `ipfs://aeris-dev/${cid}`, cid, backend: "dev-skip" };
  }

  const jwt = process.env.PINATA_JWT!;
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 },
      pinataContent: payload,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Pinata pin failed (${res.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error("Pinata response missing IpfsHash");
  }

  return {
    uri: `ipfs://${data.IpfsHash}`,
    cid: data.IpfsHash,
    backend: "pinata",
  };
}

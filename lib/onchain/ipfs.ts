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

/**
 * Opt-in flag: when set, the mint worker pins the citizen evidence photo to
 * IPFS (immutable) and references the resulting ipfs:// URI in the token
 * metadata instead of the mutable Supabase public URL. Defaults off so the
 * baseline behaviour (Supabase URL) needs no config.
 */
export function evidenceImagePinningEnabled(): boolean {
  const flag = (process.env.MINT_PIN_EVIDENCE_IMAGE ?? "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // mirror Chat's 5 MB/file cap
const ALLOWED_EVIDENCE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Fetch an http(s) image (e.g. a Supabase public evidence URL) and pin the raw
 * bytes to IPFS via Pinata's pinFileToIPFS. Enforces the same mime/size limits
 * Chat applies on upload. In dev (no PINATA_JWT) returns a synthetic ipfs:// URI
 * derived from the source URL so the pipeline can be exercised offline.
 *
 * Throws on any fetch/validation/pin failure; callers are expected to degrade
 * gracefully (fall back to the source URL) rather than fail the mint.
 */
export async function pinFileFromUrl(
  sourceUrl: string,
  name: string,
): Promise<PinnedResult> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("evidence image URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("evidence image URL must be http(s)");
  }

  if (!ipfsPinningEnabled()) {
    const cid = `bafkdevimg${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 46)}`;
    return { uri: `ipfs://aeris-dev/${cid}`, cid, backend: "dev-skip" };
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

  const ext = contentType ? contentType.split("/")[1] : "bin";
  const jwt = process.env.PINATA_JWT!;
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: contentType || "application/octet-stream" }),
    `${name}.${ext}`,
  );
  form.append("pinataMetadata", JSON.stringify({ name }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Pinata file pin failed (${res.status}): ${detail.slice(0, 240)}`);
  }
  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error("Pinata file response missing IpfsHash");
  }
  return { uri: `ipfs://${data.IpfsHash}`, cid: data.IpfsHash, backend: "pinata" };
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

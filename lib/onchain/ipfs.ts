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

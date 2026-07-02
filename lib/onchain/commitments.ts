/**
 * Phase 7 - Privacy-minimizing commitments for on-chain report metadata.
 *
 * The mint pipeline used to put exact GPS, free-text description, and a
 * photo pointer directly into public, immutable token metadata. That
 * conflicts with data-minimization principles under the Philippine Data
 * Privacy Act: once minted, that data can never be corrected or erased.
 *
 * This module replaces raw values with:
 *  - a coarse position (safe to publish, ~111m precision)
 *  - salted SHA-256 commitments of the exact position/description/photo
 *
 * The salt is generated server-side and persisted alongside the report row
 * (never minted, never client-supplied). Deleting the row (or rotating the
 * salt) on an erasure request makes the on-chain commitment practically
 * unopenable even though the hash bytes remain on-chain forever - this is a
 * cryptographic "right to be forgotten", not literal deletion.
 */

import { fetchEvidenceImageBytes } from "@/lib/onchain/ipfs";

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateCommitmentSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Rounds to 3 decimals (~111m), matching the precision already established
 * for dedupe hashing in lib/dedupe-hash.ts. */
export function coarsenPosition(position: [number, number]): [number, number] {
  const [lng, lat] = position;
  return [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
}

export async function computeGeoCommitment(
  position: [number, number],
  salt: string,
): Promise<string> {
  const [lng, lat] = position;
  return sha256Hex(`${lng.toFixed(6)}|${lat.toFixed(6)}|${salt}`);
}

export async function computeDescriptionCommitment(
  description: string,
  salt: string,
): Promise<string> {
  return sha256Hex(`${description}|${salt}`);
}

/**
 * Hashes the evidence photo's raw bytes (not just its URL) so the commitment
 * proves something about the photo's content, not merely that some URL was
 * supplied. Never throws: a fetch/validation failure just means no photo
 * commitment is attached, matching the existing "never block a mint" policy.
 */
export async function computePhotoCommitment(
  photoUrl: string,
  salt: string,
): Promise<string | undefined> {
  try {
    const { bytes } = await fetchEvidenceImageBytes(photoUrl);
    const hash = await sha256Hex(bytes);
    return sha256Hex(`${hash}|${salt}`);
  } catch (err) {
    console.error(
      `[onchain-commitments] photo commitment failed for ${photoUrl}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

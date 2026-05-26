export function normalizeDescription(description: string) {
  return description
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function computeDedupeHash(input: {
  category: string;
  description: string;
  position: [number, number];
}) {
  const [lng, lat] = input.position;
  const roundedLng = Math.round(lng * 1000) / 1000;
  const roundedLat = Math.round(lat * 1000) / 1000;
  const payload = [
    input.category.toLowerCase(),
    roundedLng.toFixed(3),
    roundedLat.toFixed(3),
    normalizeDescription(input.description).slice(0, 200),
  ].join("|");
  const data = new TextEncoder().encode(payload);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

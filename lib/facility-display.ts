import { escapeHtml } from "@/lib/sanitize";

export type FacilityDisplayProps = {
  name?: string;
  category?: string;
  categoryLabel?: string;
  facilityId?: string;
  facilityCode?: string;
  contact?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactWeb?: string;
  osmId?: string | number;
};

/** Pull phone / email / website from raw OSM tags when building scene packs. */
export function contactFieldsFromOsmTags(
  tags: Record<string, string>,
): Pick<FacilityDisplayProps, "contactPhone" | "contactEmail" | "contactWeb" | "contact"> {
  const contactPhone =
    tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"] ?? "";
  const contactEmail = tags.email ?? tags["contact:email"] ?? "";
  const contactWeb = tags.website ?? tags["contact:website"] ?? tags.url ?? "";
  const parts = [contactPhone, contactEmail, contactWeb].filter(Boolean);
  return {
    contactPhone: contactPhone || undefined,
    contactEmail: contactEmail || undefined,
    contactWeb: contactWeb || undefined,
    contact: parts.length > 0 ? parts.join(" · ") : undefined,
  };
}

const CODE_PREFIX: Record<string, string> = {
  hospital: "HSP",
  fire_station: "FR",
  police: "POL",
  school: "SCH",
  evacuation: "EVC",
  government: "GOV",
};

export function facilityFeatureKey(
  coordinates: [number, number],
  properties: GeoJSON.GeoJsonProperties | null | undefined,
): string {
  const category = String(properties?.category ?? "");
  return `${coordinates[0].toFixed(6)},${coordinates[1].toFixed(6)},${category}`;
}

export function buildFacilityCode(
  category: string,
  lon: number,
  lat: number,
): string {
  const prefix = CODE_PREFIX[category] ?? "CF";
  const n = Math.abs(Math.round(lon * 1e4 + lat * 1e4)) % 100000;
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

export function buildFacilityId(
  category: string,
  lon: number,
  lat: number,
  osmId?: string | number | null,
): string {
  if (osmId != null && String(osmId).length > 0) {
    return `OSM-${String(osmId)}`;
  }
  return `AERIS-${buildFacilityCode(category, lon, lat)}`;
}

function pickContactLine(props: FacilityDisplayProps): string {
  if (props.contact?.trim()) return props.contact.trim();
  const parts: string[] = [];
  if (props.contactPhone?.trim()) parts.push(props.contactPhone.trim());
  if (props.contactEmail?.trim()) parts.push(props.contactEmail.trim());
  if (props.contactWeb?.trim()) parts.push(props.contactWeb.trim());
  return parts.join(" · ");
}

export function normalizeFacilityDisplay(
  props: FacilityDisplayProps | null | undefined,
  coordinates: [number, number],
): {
  name: string;
  facilityId: string;
  facilityCode: string;
  contact: string;
  category: string;
} {
  const [lon, lat] = coordinates;
  const category = String(props?.category ?? "other");
  const name = String(props?.name ?? props?.categoryLabel ?? "Critical facility");
  const facilityCode =
    props?.facilityCode?.trim() ||
    buildFacilityCode(category, lon, lat);
  const facilityId =
    props?.facilityId?.trim() ||
    buildFacilityId(category, lon, lat, props?.osmId);
  const contact = pickContactLine(props ?? {}) || "Not on file";

  return { name, facilityId, facilityCode, contact, category };
}

export function buildFacilityPopupElement(
  props: FacilityDisplayProps | null | undefined,
  coordinates: [number, number],
  theme: "light" | "dark",
): HTMLDivElement {
  const row = normalizeFacilityDisplay(props, coordinates);
  const card = document.createElement("div");
  card.className = `aeris-facility-card aeris-facility-card--${theme}`;
  card.innerHTML = `
    <div class="aeris-facility-card__header">
      <span class="aeris-facility-card__eyebrow">Critical facility</span>
      <span class="aeris-facility-card__code">${escapeHtml(row.facilityCode)}</span>
    </div>
    <h3 class="aeris-facility-card__name">${escapeHtml(row.name)}</h3>
    <dl class="aeris-facility-card__meta">
      <div class="aeris-facility-card__row">
        <dt>ID#</dt>
        <dd>${escapeHtml(row.facilityId)}</dd>
      </div>
      <div class="aeris-facility-card__row">
        <dt>Contact</dt>
        <dd>${escapeHtml(row.contact)}</dd>
      </div>
    </dl>
  `;
  return card;
}

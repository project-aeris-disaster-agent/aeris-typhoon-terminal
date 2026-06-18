/**
 * PSA PSGC (Philippine Standard Geographic Code) data types and utilities.
 * Full barangay data is fetched from https://psgc.gitlab.io/api/ at runtime.
 */

export type PsgcRegion = {
  code: string;
  name: string;
  regionName: string;
  islandGroup: string;
  psgc10DigitCode: string;
};

export type PsgcProvince = {
  code: string;
  name: string;
  regionCode: string;
  islandGroup: string;
  psgc10DigitCode: string;
};

export type PsgcMunicipality = {
  code: string;
  name: string;
  oldName?: string;
  isCapital?: boolean;
  cityClass?: string;
  incomeClassification?: string;
  urbanRural?: string;
  population?: number;
  provinceCode: string;
  districtCode?: string;
  regionCode: string;
  islandGroup: string;
  psgc10DigitCode: string;
};

export type PsgcBarangay = {
  code: string;
  name: string;
  oldName?: string;
  subMunicipalityCode?: string;
  municipalityCode?: string;
  cityCode?: string;
  provinceCode?: string;
  regionCode: string;
  islandGroup: string;
  psgc10DigitCode: string;
  urbanRural?: string;
  population?: number;
};

export type LocationDetails = {
  code: string;
  name: string;
  municipality: string;
  province: string;
  region: string;
  population?: number;
  urbanRural?: string;
};

const PSGC_API = "https://psgc.gitlab.io/api";

type FetchState<T> = { data: T | null; loading: boolean; error: string | null };

const cache = new Map<string, { data: unknown; fetchedAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

async function cachedFetch<T>(path: string): Promise<T> {
  const key = path;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
    return entry.data as T;
  }
  const res = await fetch(`${PSGC_API}${path}`);
  if (!res.ok) throw new Error(`PSGC API ${res.status}: ${path}`);
  const data = (await res.json()) as T;
  cache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

export async function fetchRegions(): Promise<PsgcRegion[]> {
  return cachedFetch<PsgcRegion[]>("/regions/");
}

export async function fetchProvincesByRegion(
  regionCode: string,
): Promise<PsgcProvince[]> {
  return cachedFetch<PsgcProvince[]>(`/regions/${regionCode}/provinces/`);
}

export async function fetchMunicipalitiesByProvince(
  provinceCode: string,
): Promise<PsgcMunicipality[]> {
  return cachedFetch<PsgcMunicipality[]>(
    `/provinces/${provinceCode}/cities-municipalities/`,
  );
}

export async function fetchBarangaysByMunicipality(
  municipalityCode: string,
): Promise<PsgcBarangay[]> {
  return cachedFetch<PsgcBarangay[]>(
    `/cities-municipalities/${municipalityCode}/barangays/`,
  );
}

export async function fetchBarangayDetails(
  barangayCode: string,
): Promise<PsgcBarangay> {
  return cachedFetch<PsgcBarangay>(`/barangays/${barangayCode}/`);
}

export function createFetchState<T>(initial: T | null = null): FetchState<T> {
  return { data: initial, loading: false, error: null };
}

/** The 27 official barangays of Naga City, Camarines Sur (alphabetical). */
export const NAGA_BARANGAYS: readonly string[] = [
  "Abella",
  "Bagumbayan Norte",
  "Bagumbayan Sur",
  "Balatas",
  "Calauag",
  "Cararayan",
  "Carolina",
  "Concepcion Grande",
  "Concepcion Pequeño",
  "Dayangdang",
  "Del Rosario",
  "Dinaga",
  "Igualdad Interior",
  "Lerma",
  "Liboton",
  "Mabolo",
  "Pacol",
  "Panicuason",
  "Peñafrancia",
  "Sabang",
  "San Felipe",
  "San Francisco",
  "San Isidro",
  "Santa Cruz",
  "Tabuco",
  "Tinago",
  "Triangulo",
] as const;

/** Island group display labels */
export const ISLAND_GROUPS: Record<string, string> = {
  Luzon: "Luzon",
  Visayas: "Visayas",
  Mindanao: "Mindanao",
};

/** Region code → friendly abbreviation for display */
export const REGION_ABBREV: Record<string, string> = {
  "130000000": "NCR",
  "010000000": "Region I",
  "020000000": "Region II",
  "030000000": "Region III",
  "040000000": "Region IV-A",
  "170000000": "MIMAROPA",
  "050000000": "Region V",
  "060000000": "Region VI",
  "070000000": "Region VII",
  "080000000": "Region VIII",
  "090000000": "Region IX",
  "100000000": "Region X",
  "110000000": "Region XI",
  "120000000": "Region XII",
  "160000000": "Region XIII",
  "150000000": "BARMM",
  "140000000": "CAR",
};

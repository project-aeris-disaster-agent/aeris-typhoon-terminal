/** Shared by `/api/wind-field` and the client wind canvas. */
export type WindFieldPayload = {
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
  u: number[];
  v: number[];
  /** Mean sea level pressure (hPa), row-major; used for LPA-style circulation. */
  p: number[];
  generatedAt: string;
};

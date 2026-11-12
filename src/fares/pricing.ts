/** Spec scope decision: a fixed fare for any trip inside the service area. */
export const FIXED_FARE = { amount: 8.0, currency: 'CAD' } as const;

/**
 * The Antigonish service area: a circle around the town centre. 10 km covers
 * the town, St. F.X. and the surrounding communities.
 */
export const SERVICE_AREA = { lat: 45.6169, lng: -61.9986, radiusKm: 10 } as const;

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres (haversine formula). */
export function distanceKm(a: Point, b: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isWithinServiceArea(point: Point): boolean {
  return distanceKm(point, SERVICE_AREA) <= SERVICE_AREA.radiusKm;
}

/**
 * Assumed average driving speed in town. A routing service could replace
 * this estimate later; until then ETAs are distance at this speed.
 */
export const AVERAGE_SPEED_KMH = 30;

/** Estimated seconds to drive `km` at AVERAGE_SPEED_KMH, rounded to the second. */
export function etaSeconds(km: number): number {
  return Math.round((km / AVERAGE_SPEED_KMH) * 3600);
}

import type { Trip } from './entities/trip.entity.js';
import { distanceKm, type Point } from './pricing.js';
import type { PlaceResponse } from './trip-view.js';

/** Spec: `TripRequest`. What a Driver sees before accepting. */
export interface TripRequestResponse {
  tripId: string;
  pickup: PlaceResponse;
  distanceKm: number;
  /** First name only: the full name, phone and photo come after accepting. */
  passengerName: string;
  expiresAt: string;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/** Maps an open request (with `passenger` loaded) for a Driver at `from`. */
export function toTripRequest(trip: Trip, from: Point, expiresAt: Date): TripRequestResponse {
  const pickup = { lat: trip.originLat, lng: trip.originLng };
  return {
    tripId: trip.id,
    pickup: { ...pickup, address: trip.originAddress },
    distanceKm: Math.round(distanceKm(from, pickup) * 10) / 10,
    passengerName: firstName(trip.passenger?.fullName ?? ''),
    expiresAt: expiresAt.toISOString(),
  };
}

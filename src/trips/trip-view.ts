import { InternalServerErrorException } from '@nestjs/common';
import type { User } from '../users/entities/user.entity.js';
import { Role } from '../users/role.enum.js';
import type { PhotoUrlSigner, VehicleResponse } from '../users/user-profile.js';
import type { Trip } from './entities/trip.entity.js';
import { CancelReason, PassengerCancelReason, TripStatus } from './trip.enums.js';

export interface PlaceResponse {
  lat: number;
  lng: number;
  address: string | null;
}

/** Spec: `PassengerSummary` */
export interface PassengerSummaryResponse {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
}

/** Spec: `DriverSummary` */
export interface DriverSummaryResponse extends PassengerSummaryResponse {
  vehicle: VehicleResponse;
}

export interface CancelDetailsResponse {
  reason: PassengerCancelReason;
  note: string | null;
}

/** Spec: `Trip` */
export interface TripResponse {
  id: string;
  status: TripStatus;
  origin: PlaceResponse;
  destination: PlaceResponse;
  fare: { amount: number; currency: string };
  passenger: PassengerSummaryResponse | null;
  driver: DriverSummaryResponse | null;
  cancelReason: CancelReason | null;
  cancelDetails: CancelDetailsResponse | null;
  requestedAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** The relations toTripView() needs loaded. */
export const WITH_PEOPLE = { passenger: true, driver: { driverDetails: true } } as const;

export interface TripViewer {
  id: string;
  role: Role;
}

/** Statuses in which the assigned Driver may see who the Passenger is. */
const DRIVER_SEES_PASSENGER: readonly TripStatus[] = [
  TripStatus.ACCEPTED,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.IN_PROGRESS,
  TripStatus.COMPLETED,
];

/**
 * Maps a trip (with `passenger`, `driver` and `driver.driverDetails` loaded)
 * to what this viewer is allowed to see:
 * - The Passenger sees everything on their own trip, except the Driver once
 *   the trip is cancelled.
 * - The Driver sees the Passenger only while the trip is active or after it
 *   is completed, never on a cancelled trip. The Passenger's own cancellation
 *   reason is never shown to a Driver.
 * Callers must already have checked that the viewer is on the trip.
 */
export function toTripView(
  trip: Trip,
  viewer: TripViewer,
  signPhotoUrl: PhotoUrlSigner,
): TripResponse {
  const isPassenger = viewer.role === Role.PASSENGER && viewer.id === trip.passengerId;
  const isDriver = viewer.role === Role.DRIVER && viewer.id === trip.driverId;
  if (!isPassenger && !isDriver) {
    throw new InternalServerErrorException(`User ${viewer.id} is not on trip ${trip.id}`);
  }

  const showPassenger = isPassenger || DRIVER_SEES_PASSENGER.includes(trip.status);
  const showDriver = isDriver || trip.status !== TripStatus.CANCELLED;

  return {
    id: trip.id,
    status: trip.status,
    origin: { lat: trip.originLat, lng: trip.originLng, address: trip.originAddress },
    destination: {
      lat: trip.destinationLat,
      lng: trip.destinationLng,
      address: trip.destinationAddress,
    },
    fare: { amount: trip.fareAmount, currency: trip.fareCurrency },
    passenger: showPassenger ? summary(required(trip.passenger, 'passenger', trip), signPhotoUrl) : null,
    driver: showDriver && trip.driverId ? driverSummary(required(trip.driver, 'driver', trip), signPhotoUrl) : null,
    cancelReason: trip.cancelReason,
    cancelDetails:
      isPassenger && trip.passengerCancelReason
        ? { reason: trip.passengerCancelReason, note: trip.cancelNote }
        : null,
    requestedAt: trip.requestedAt.toISOString(),
    acceptedAt: iso(trip.acceptedAt),
    arrivedAt: iso(trip.arrivedAt),
    startedAt: iso(trip.startedAt),
    completedAt: iso(trip.completedAt),
    cancelledAt: iso(trip.cancelledAt),
  };
}

function summary(user: User, signPhotoUrl: PhotoUrlSigner): PassengerSummaryResponse {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    photoUrl: user.photoKey ? signPhotoUrl(user.photoKey) : null,
  };
}

function driverSummary(user: User, signPhotoUrl: PhotoUrlSigner): DriverSummaryResponse {
  const d = required(user.driverDetails, 'driver details', { id: user.id });
  return {
    ...summary(user, signPhotoUrl),
    vehicle: {
      make: d.vehicleMake,
      model: d.vehicleModel,
      colour: d.vehicleColour,
      plateNumber: d.plateNumber,
    },
  };
}

function required<T>(value: T | null | undefined, what: string, owner: { id: string }): T {
  if (!value) {
    throw new InternalServerErrorException(`${what} not loaded for ${owner.id}`);
  }
  return value;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

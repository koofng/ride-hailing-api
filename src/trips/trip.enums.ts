/** Spec: `TripStatus` */
export enum TripStatus {
  REQUESTED = 'REQUESTED',
  ACCEPTED = 'ACCEPTED',
  DRIVER_ARRIVED = 'DRIVER_ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** A trip in one of these statuses blocks its Passenger (and Driver) from another. */
export const ACTIVE_STATUSES: readonly TripStatus[] = [
  TripStatus.REQUESTED,
  TripStatus.ACCEPTED,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.IN_PROGRESS,
];

/** Spec: `CancelReason`. Who or what cancelled the trip. */
export enum CancelReason {
  PASSENGER_CANCELLED = 'PASSENGER_CANCELLED',
  NO_DRIVER_FOUND = 'NO_DRIVER_FOUND',
}

/** Why the Passenger cancelled, chosen from a list in the app. */
export enum PassengerCancelReason {
  CHANGED_MIND = 'CHANGED_MIND',
  WAIT_TOO_LONG = 'WAIT_TOO_LONG',
  BOOKED_BY_MISTAKE = 'BOOKED_BY_MISTAKE',
  OTHER = 'OTHER',
}

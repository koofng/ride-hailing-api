import { InternalServerErrorException } from '@nestjs/common';
import { Role } from './role.enum.js';
import type { User } from './entities/user.entity.js';

/** Spec: `Vehicle` */
export interface VehicleResponse {
  make: string;
  model: string;
  colour: string;
  plateNumber: string;
}

/** Spec: `DriverDetails` */
export interface DriverDetailsResponse {
  licenceNumber: string;
  vehicle: VehicleResponse;
  available: boolean;
}

/** Spec: `UserProfile` */
export interface UserProfileResponse {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  createdAt: string;
  driverDetails: DriverDetailsResponse | null;
}

/** Turns a stored photo key into a URL the client can load (a signed link). */
export type PhotoUrlSigner = (key: string) => string;

/**
 * Maps a user (with `driverDetails` loaded) to the spec's `UserProfile`.
 * Enforces the spec rule: `driverDetails` is always present for Drivers and
 * always null for Passengers.
 */
export function toUserProfile(user: User, signPhotoUrl: PhotoUrlSigner): UserProfileResponse {
  let driverDetails: DriverDetailsResponse | null = null;

  if (user.role === Role.DRIVER) {
    const d = user.driverDetails;
    if (!d) {
      throw new InternalServerErrorException(
        `Driver ${user.id} has no driver details (or they were not loaded)`,
      );
    }
    driverDetails = {
      licenceNumber: d.licenceNumber,
      vehicle: {
        make: d.vehicleMake,
        model: d.vehicleModel,
        colour: d.vehicleColour,
        plateNumber: d.plateNumber,
      },
      available: d.available,
    };
  }

  return {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    photoUrl: user.photoKey ? signPhotoUrl(user.photoKey) : null,
    createdAt: user.createdAt.toISOString(),
    driverDetails,
  };
}

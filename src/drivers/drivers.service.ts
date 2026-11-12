import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { ACTIVE_STATUSES } from '../trips/trip.enums.js';
import { DriverDetails } from '../users/entities/driver-details.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AvailabilityDto } from './dto/availability.dto.js';

export const CANNOT_GO_OFFLINE = 'You cannot go offline while you have an active trip';

/** Spec: `AvailabilityResponse` */
export interface AvailabilityResponse {
  available: boolean;
}

/** Driver presence: online status and last known position (spec tag: Drivers). */
@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(DriverDetails) private readonly drivers: Repository<DriverDetails>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly users: UsersService,
  ) {}

  /**
   * Going online records the Driver's position; going offline forgets it.
   * A Driver cannot go offline in the middle of a trip.
   */
  async setAvailability(caller: AuthUser, dto: AvailabilityDto): Promise<AvailabilityResponse> {
    if (!dto.available) {
      const onTrip = await this.trips.exists({
        where: { driverId: caller.id, status: In([...ACTIVE_STATUSES]) },
      });
      if (onTrip) throw new ConflictException(CANNOT_GO_OFFLINE);
      await this.users.setDriverAvailability(caller.id, false);
      return { available: false };
    }

    await this.drivers.update(
      { userId: caller.id },
      { available: true, lastLat: dto.lat!, lastLng: dto.lng!, locationUpdatedAt: () => 'now()' },
    );
    return { available: true };
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { distanceKm, type Point } from '../trips/pricing.js';
import { ACTIVE_STATUSES } from '../trips/trip.enums.js';
import { DriverDetails } from '../users/entities/driver-details.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AvailabilityDto } from './dto/availability.dto.js';

export const CANNOT_GO_OFFLINE = 'You cannot go offline while you have an active trip';

/** A Driver whose position is older than this is left off the map. */
export const LOCATION_MAX_AGE_SECONDS = 300;

/** The most Drivers returned at once; the nearest come first. */
const MAX_ACTIVE_DRIVERS = 50;

/** Spec: `ActiveDriver`. Only an id and a position: no name, phone or vehicle. */
export interface ActiveDriverResponse {
  driverId: string;
  location: Point;
  lastUpdatedAt: string;
}

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

  /**
   * Updates an online Driver's position. Ignored while offline, so offline
   * Drivers are never tracked.
   */
  async recordLocation(driverId: string, at: Point): Promise<void> {
    await this.drivers
      .createQueryBuilder()
      .update(DriverDetails)
      .set({ lastLat: at.lat, lastLng: at.lng, locationUpdatedAt: () => 'now()' })
      .where('user_id = :driverId AND available = true', { driverId })
      .execute();
  }

  /**
   * Online Drivers within `radiusKm` of `center` who are free to take a trip
   * and reported their position in the last 5 minutes, nearest first.
   */
  async listActive(center: Point, radiusKm: number): Promise<ActiveDriverResponse[]> {
    // A bounding box narrows the rows in SQL; the exact distance is checked below.
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
    const online = await this.drivers
      .createQueryBuilder('d')
      .where('d.available = true')
      .andWhere('d.location_updated_at > now() - make_interval(secs => :maxAge)', {
        maxAge: LOCATION_MAX_AGE_SECONDS,
      })
      .andWhere('d.last_lat BETWEEN :minLat AND :maxLat', {
        minLat: center.lat - latDelta,
        maxLat: center.lat + latDelta,
      })
      .andWhere('d.last_lng BETWEEN :minLng AND :maxLng', {
        minLng: center.lng - lngDelta,
        maxLng: center.lng + lngDelta,
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.user_id AND t.status IN (:...active))',
        { active: ACTIVE_STATUSES },
      )
      .getMany();

    return online
      .map((d) => ({ d, km: distanceKm(center, { lat: d.lastLat!, lng: d.lastLng! }) }))
      .filter(({ km }) => km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_ACTIVE_DRIVERS)
      .map(({ d }) => ({
        driverId: d.userId,
        location: { lat: d.lastLat!, lng: d.lastLng! },
        lastUpdatedAt: d.locationUpdatedAt!.toISOString(),
      }));
  }
}

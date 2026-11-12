import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { Trip } from './entities/trip.entity.js';
import type { Point } from './pricing.js';
import { ACTIVE_STATUSES, TripStatus } from './trip.enums.js';
import { TripExpiryService } from './trip-expiry.service.js';
import { toTripRequest, type TripRequestResponse } from './trip-request-view.js';

/** The most requests returned at once; the nearest come first. */
const MAX_REQUESTS = 50;

/** Trip actions performed by a Driver (spec tag: Driver Trips). */
@Injectable()
export class DriverTripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly expiry: TripExpiryService,
  ) {}

  /**
   * Open requests a Driver can accept, nearest pickup first. A Driver on an
   * active trip gets none, because they cannot accept another.
   */
  async listRequests(caller: AuthUser, from: Point): Promise<TripRequestResponse[]> {
    if (await this.hasActiveTrip(caller.id)) return [];

    const open = await this.openRequests().leftJoinAndSelect('trip.passenger', 'passenger').getMany();
    return open
      .map((trip) => toTripRequest(trip, from, this.expiry.expiresAt(trip.requestedAt)))
      .sort((a, b) => a.distanceKm - b.distanceKm || a.expiresAt.localeCompare(b.expiresAt))
      .slice(0, MAX_REQUESTS);
  }

  /** REQUESTED trips that have not expired yet, whether or not a sweep has run. */
  private openRequests() {
    return this.trips
      .createQueryBuilder('trip')
      .where('trip.status = :requested', { requested: TripStatus.REQUESTED })
      .andWhere('trip.requested_at > now() - make_interval(secs => :ttl)', {
        ttl: this.expiry.ttlSeconds,
      });
  }

  private hasActiveTrip(driverId: string): Promise<boolean> {
    return this.trips.exists({ where: { driverId, status: In([...ACTIVE_STATUSES]) } });
  }
}

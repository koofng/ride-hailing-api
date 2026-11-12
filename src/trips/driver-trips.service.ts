import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { violatesConstraint } from '../common/errors/violates-constraint.js';
import { StorageService } from '../storage/storage.service.js';
import { Trip } from './entities/trip.entity.js';
import type { Point } from './pricing.js';
import { ACTIVE_STATUSES, TripStatus } from './trip.enums.js';
import { TripExpiryService } from './trip-expiry.service.js';
import { toTripRequest, type TripRequestResponse } from './trip-request-view.js';
import { toTripView, WITH_PEOPLE, type TripResponse } from './trip-view.js';
import { TRIP_NOT_FOUND } from './trips.service.js';

/** The most requests returned at once; the nearest come first. */
const MAX_REQUESTS = 50;

export const NO_LONGER_AVAILABLE = 'This trip is no longer available';
export const DRIVER_BUSY = 'Complete your current trip before accepting a new one';

/** Trip actions performed by a Driver (spec tag: Driver Trips). */
@Injectable()
export class DriverTripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly expiry: TripExpiryService,
    private readonly storage: StorageService,
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

  /**
   * Takes an open request. One conditional UPDATE, so when several Drivers
   * accept at once exactly one wins, and it cannot race the Passenger
   * cancelling. The partial unique index on driver_id stops a Driver from
   * holding two active trips even if two of their accepts run together.
   */
  async accept(caller: AuthUser, tripId: string): Promise<TripResponse> {
    if (!isUUID(tripId)) throw new NotFoundException(TRIP_NOT_FOUND);
    if (await this.hasActiveTrip(caller.id)) throw new ConflictException(DRIVER_BUSY);

    let affected: number | undefined;
    try {
      ({ affected } = await this.trips
        .createQueryBuilder()
        .update(Trip)
        .set({ status: TripStatus.ACCEPTED, driverId: caller.id, acceptedAt: () => 'now()' })
        .where('id = :tripId AND status = :requested', { tripId, requested: TripStatus.REQUESTED })
        .andWhere('requested_at > now() - make_interval(secs => :ttl)', { ttl: this.expiry.ttlSeconds })
        .execute());
    } catch (error) {
      if (violatesConstraint(error, 'UQ_trips_driver_active')) throw new ConflictException(DRIVER_BUSY);
      throw error;
    }

    if (!affected) {
      // Taken by another Driver, cancelled, or expired.
      if (!(await this.trips.exists({ where: { id: tripId } }))) {
        throw new NotFoundException(TRIP_NOT_FOUND);
      }
      throw new ConflictException(NO_LONGER_AVAILABLE);
    }
    return this.view(tripId, caller);
  }

  private async view(tripId: string, caller: AuthUser): Promise<TripResponse> {
    const trip = await this.trips.findOneOrFail({ where: { id: tripId }, relations: WITH_PEOPLE });
    return toTripView(trip, caller, (key) => this.storage.signedPhotoUrl(key));
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

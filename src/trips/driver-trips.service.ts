import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { violatesConstraint } from '../common/errors/violates-constraint.js';
import { StorageService } from '../storage/storage.service.js';
import { TripDecline } from './entities/trip-decline.entity.js';
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

export const INVALID_TRANSITION = "This action is not allowed in the trip's current status";

/** SQL condition: the trip in `tripColumn` was not declined by :driverId. */
const notDeclinedBy = (tripColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM trip_declines d WHERE d.trip_id = ${tripColumn} AND d.driver_id = :driverId)`;

/** Trip actions performed by a Driver (spec tag: Driver Trips). */
@Injectable()
export class DriverTripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(TripDecline) private readonly declines: Repository<TripDecline>,
    private readonly expiry: TripExpiryService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Open requests a Driver can accept, nearest pickup first, leaving out the
   * ones they declined. A Driver on an active trip gets none, because they
   * cannot accept another.
   */
  async listRequests(caller: AuthUser, from: Point): Promise<TripRequestResponse[]> {
    if (await this.hasActiveTrip(caller.id)) return [];

    const open = await this.openRequests()
      .andWhere(notDeclinedBy('trip.id'), { driverId: caller.id })
      .leftJoinAndSelect('trip.passenger', 'passenger')
      .getMany();
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
        .andWhere(notDeclinedBy('trips.id'), { driverId: caller.id })
        .execute());
    } catch (error) {
      if (violatesConstraint(error, 'UQ_trips_driver_active')) throw new ConflictException(DRIVER_BUSY);
      throw error;
    }

    if (!affected) {
      // Taken by another Driver, cancelled, expired, or declined by this Driver.
      if (!(await this.trips.exists({ where: { id: tripId } }))) {
        throw new NotFoundException(TRIP_NOT_FOUND);
      }
      throw new ConflictException(NO_LONGER_AVAILABLE);
    }
    return this.view(tripId, caller);
  }

  /**
   * Removes an open request from this Driver's list; the trip stays open for
   * everyone else. Declining the same request twice is harmless.
   */
  async decline(caller: AuthUser, tripId: string): Promise<void> {
    if (!isUUID(tripId)) throw new NotFoundException(TRIP_NOT_FOUND);
    const isOpen = await this.openRequests().andWhere('trip.id = :tripId', { tripId }).getExists();
    if (!isOpen) {
      if (!(await this.trips.exists({ where: { id: tripId } }))) {
        throw new NotFoundException(TRIP_NOT_FOUND);
      }
      throw new ConflictException(NO_LONGER_AVAILABLE);
    }
    await this.declines
      .createQueryBuilder()
      .insert()
      .values({ tripId, driverId: caller.id })
      .orIgnore()
      .execute();
  }

  /** ACCEPTED -> DRIVER_ARRIVED: the Driver is at the pickup. */
  markArrived(caller: AuthUser, tripId: string): Promise<TripResponse> {
    return this.advance(caller, tripId, TripStatus.ACCEPTED, TripStatus.DRIVER_ARRIVED, 'arrivedAt');
  }

  /** DRIVER_ARRIVED -> IN_PROGRESS: the Passenger is in the car. */
  start(caller: AuthUser, tripId: string): Promise<TripResponse> {
    return this.advance(caller, tripId, TripStatus.DRIVER_ARRIVED, TripStatus.IN_PROGRESS, 'startedAt');
  }

  /**
   * Moves the caller's own trip one step along the status flow and stamps the
   * time. A conditional UPDATE, so a step cannot be skipped or repeated even
   * when requests overlap. A trip the Driver is not on gets 404; one in the
   * wrong status gets 409.
   */
  private async advance(
    caller: AuthUser,
    tripId: string,
    from: TripStatus,
    to: TripStatus,
    stamp: 'arrivedAt' | 'startedAt' | 'completedAt',
  ): Promise<TripResponse> {
    if (!isUUID(tripId)) throw new NotFoundException(TRIP_NOT_FOUND);

    const { affected } = await this.trips
      .createQueryBuilder()
      .update(Trip)
      .set({ status: to, [stamp]: () => 'now()' })
      .where('id = :tripId AND driver_id = :driverId AND status = :from', {
        tripId,
        driverId: caller.id,
        from,
      })
      .execute();

    if (!affected) {
      if (!(await this.trips.exists({ where: { id: tripId, driverId: caller.id } }))) {
        throw new NotFoundException(TRIP_NOT_FOUND);
      }
      throw new ConflictException(INVALID_TRANSITION);
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

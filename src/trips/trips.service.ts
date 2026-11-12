import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { In, QueryFailedError, Repository, type FindOptionsWhere } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { StorageService } from '../storage/storage.service.js';
import { Role } from '../users/role.enum.js';
import type { CancelTripDto } from './dto/cancel-trip.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { ListTripsQuery } from './dto/list-trips.query.js';
import { Trip } from './entities/trip.entity.js';
import { FIXED_FARE, isWithinServiceArea } from './pricing.js';
import { ACTIVE_STATUSES, CancelReason, TripStatus } from './trip.enums.js';
import { toTripView, type TripResponse } from './trip-view.js';

export const ALREADY_ACTIVE = 'You already have an active trip';
export const OUTSIDE_SERVICE_AREA = 'Pickup or destination is outside the Antigonish service area';
export const TRIP_NOT_FOUND = 'Trip not found';

/** Why a trip that is no longer REQUESTED cannot be cancelled. */
const CANNOT_CANCEL: Partial<Record<TripStatus, string>> = {
  [TripStatus.ACCEPTED]: 'A Driver has already accepted this trip, so it can no longer be cancelled',
  [TripStatus.DRIVER_ARRIVED]: 'A Driver has already accepted this trip, so it can no longer be cancelled',
  [TripStatus.IN_PROGRESS]: 'A Driver has already accepted this trip, so it can no longer be cancelled',
  [TripStatus.COMPLETED]: 'This trip has already been completed',
  [TripStatus.CANCELLED]: 'This trip has already been cancelled',
};

/** Spec: `TripPage` */
export interface TripPage {
  items: TripResponse[];
  page: number;
  size: number;
  totalItems: number;
}

/** Everything toTripView() needs. */
const WITH_PEOPLE = { passenger: true, driver: { driverDetails: true } } as const;

@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    private readonly storage: StorageService,
  ) {}

  async create(caller: AuthUser, dto: CreateTripDto): Promise<TripResponse> {
    if (!isWithinServiceArea(dto.origin) || !isWithinServiceArea(dto.destination)) {
      throw new UnprocessableEntityException(OUTSIDE_SERVICE_AREA);
    }
    if (await this.hasActiveTrip(caller.id)) {
      throw new ConflictException(ALREADY_ACTIVE);
    }

    let id: string;
    try {
      ({ id } = await this.trips.save(
        this.trips.create({
          passengerId: caller.id,
          status: TripStatus.REQUESTED,
          originLat: dto.origin.lat,
          originLng: dto.origin.lng,
          originAddress: dto.origin.address ?? null,
          destinationLat: dto.destination.lat,
          destinationLng: dto.destination.lng,
          destinationAddress: dto.destination.address ?? null,
          fareAmount: FIXED_FARE.amount,
          fareCurrency: FIXED_FARE.currency,
        }),
      ));
    } catch (error) {
      // Two bookings at the same moment both pass the check above; the
      // partial unique index lets only one of them in.
      if (violates(error, 'UQ_trips_passenger_active')) {
        throw new ConflictException(ALREADY_ACTIVE);
      }
      throw error;
    }
    return this.view(await this.load(id), caller);
  }

  /** Trips the caller booked (Passenger) or accepted (Driver), newest first. */
  async list(caller: AuthUser, query: ListTripsQuery): Promise<TripPage> {
    const statuses = query.status?.length ? { status: In(query.status) } : {};
    const [trips, totalItems] = await this.trips.findAndCount({
      where: { ...this.ownedBy(caller), ...statuses },
      relations: WITH_PEOPLE,
      order: { requestedAt: 'DESC', id: 'DESC' },
      skip: query.page * query.size,
      take: query.size,
    });
    return {
      items: trips.map((trip) => this.view(trip, caller)),
      page: query.page,
      size: query.size,
      totalItems,
    };
  }

  /**
   * The trip a Passenger or Driver is currently on, or null. A Driver has no
   * active trip until they accept one, so REQUESTED never matches for them.
   */
  async findActive(caller: AuthUser): Promise<TripResponse | null> {
    const trip = await this.trips.findOne({
      where: { ...this.ownedBy(caller), status: In([...ACTIVE_STATUSES]) },
      relations: WITH_PEOPLE,
    });
    return trip ? this.view(trip, caller) : null;
  }

  /**
   * A trip the caller is not on gets the same 404 as one that does not exist,
   * so trip IDs cannot be probed.
   */
  async findOne(caller: AuthUser, tripId: string): Promise<TripResponse> {
    const trip = isUUID(tripId)
      ? await this.trips.findOne({
          where: { id: tripId, ...this.ownedBy(caller) },
          relations: WITH_PEOPLE,
        })
      : null;
    if (!trip) {
      throw new NotFoundException(TRIP_NOT_FOUND);
    }
    return this.view(trip, caller);
  }

  /**
   * Cancels the Passenger's trip, only while it is REQUESTED. A single
   * conditional UPDATE, so a cancel and a Driver accepting at the same moment
   * cannot both succeed.
   */
  async cancel(caller: AuthUser, tripId: string, dto: CancelTripDto): Promise<TripResponse> {
    if (!isUUID(tripId)) throw new NotFoundException(TRIP_NOT_FOUND);

    const result = await this.trips
      .createQueryBuilder()
      .update(Trip)
      .set({
        status: TripStatus.CANCELLED,
        cancelReason: CancelReason.PASSENGER_CANCELLED,
        passengerCancelReason: dto.reason,
        cancelNote: dto.note ?? null,
        cancelledAt: () => 'now()',
      })
      .where('id = :tripId AND passenger_id = :passengerId AND status = :requested', {
        tripId,
        passengerId: caller.id,
        requested: TripStatus.REQUESTED,
      })
      .execute();

    if (!result.affected) {
      const trip = await this.trips.findOne({ where: { id: tripId, passengerId: caller.id } });
      if (!trip) throw new NotFoundException(TRIP_NOT_FOUND);
      throw new ConflictException(CANNOT_CANCEL[trip.status]);
    }
    return this.view(await this.load(tripId), caller);
  }

  /** Passengers own the trips they booked; Drivers the trips they accepted. */
  private ownedBy(caller: AuthUser): FindOptionsWhere<Trip> {
    return caller.role === Role.PASSENGER ? { passengerId: caller.id } : { driverId: caller.id };
  }

  private hasActiveTrip(passengerId: string): Promise<boolean> {
    return this.trips.exists({ where: { passengerId, status: In([...ACTIVE_STATUSES]) } });
  }

  private load(id: string): Promise<Trip> {
    return this.trips.findOneOrFail({ where: { id }, relations: WITH_PEOPLE });
  }

  private view(trip: Trip, caller: AuthUser): TripResponse {
    return toTripView(trip, caller, (key) => this.storage.signedPhotoUrl(key));
  }
}

function violates(error: unknown, constraint: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { constraint?: string } | undefined)?.constraint === constraint
  );
}

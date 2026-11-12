import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import type { AuthUser } from '../auth/token.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import { Trip } from './entities/trip.entity.js';
import { FIXED_FARE, isWithinServiceArea } from './pricing.js';
import { ACTIVE_STATUSES, TripStatus } from './trip.enums.js';
import { toTripView, type TripResponse } from './trip-view.js';

export const ALREADY_ACTIVE = 'You already have an active trip';
export const OUTSIDE_SERVICE_AREA = 'Pickup or destination is outside the Antigonish service area';

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

  private hasActiveTrip(passengerId: string): Promise<boolean> {
    return this.trips.exists({ where: { passengerId, status: In([...ACTIVE_STATUSES]) } });
  }

  private load(id: string): Promise<Trip> {
    return this.trips.findOneOrFail({
      where: { id },
      relations: { passenger: true, driver: { driverDetails: true } },
    });
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

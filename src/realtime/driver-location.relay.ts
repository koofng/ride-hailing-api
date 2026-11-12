import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DriversService } from '../drivers/drivers.service.js';
import { distanceKm, etaSeconds } from '../fares/pricing.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { TripStatus } from '../trips/trip.enums.js';
import type { DriverLocationDto } from './dto/driver-location.dto.js';

/** Statuses in which the Passenger follows the Driver on the map. */
const FOLLOWED: TripStatus[] = [TripStatus.ACCEPTED, TripStatus.DRIVER_ARRIVED, TripStatus.IN_PROGRESS];

/** Spec: `DriverLocationEvent` (plus the optional heading the Driver sent). */
export interface DriverLocationEvent {
  tripId: string;
  lat: number;
  lng: number;
  heading?: number;
  etaSeconds: number;
}

/**
 * Handles a Driver's live position: stores it (only while online, as for
 * REST) and, during a trip, works out what to send their Passenger.
 */
@Injectable()
export class DriverLocationRelay {
  constructor(
    private readonly drivers: DriversService,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  /** Returns the event for the Passenger, or null if the Driver is not on a trip. */
  async update(
    driverId: string,
    location: DriverLocationDto,
  ): Promise<{ passengerId: string; event: DriverLocationEvent } | null> {
    const [, trip] = await Promise.all([
      this.drivers.recordLocation(driverId, location),
      this.trips.findOne({ where: { driverId, status: In(FOLLOWED) } }),
    ]);
    if (!trip) return null;

    // To the pickup until the ride starts, then to the destination.
    const target =
      trip.status === TripStatus.IN_PROGRESS
        ? { lat: trip.destinationLat, lng: trip.destinationLng }
        : { lat: trip.originLat, lng: trip.originLng };
    return {
      passengerId: trip.passengerId,
      event: {
        tripId: trip.id,
        lat: location.lat,
        lng: location.lng,
        ...(location.heading === undefined ? {} : { heading: location.heading }),
        etaSeconds: etaSeconds(distanceKm(location, target)),
      },
    };
  }
}

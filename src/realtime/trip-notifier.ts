import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriversService } from '../drivers/drivers.service.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { TripEvents, type TripEvent } from '../trips/trip-events.js';
import { TripExpiryService } from '../trips/trip-expiry.service.js';
import { toTripRequest } from '../trips/trip-request-view.js';
import { RealtimeGateway } from './realtime.gateway.js';

/** Spec: `TripWithdrawnEvent.reason` */
type WithdrawnReason = 'PASSENGER_CANCELLED' | 'ACCEPTED_BY_ANOTHER_DRIVER' | 'EXPIRED';

/**
 * Turns trip events into the spec's WebSocket events (see the event table in
 * ride-hailing-api.yaml). Delivery is best effort: a REST call already
 * succeeded, and clients can always re-fetch the trip.
 */
@Injectable()
export class TripNotifier implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  constructor(
    private readonly events: TripEvents,
    private readonly gateway: RealtimeGateway,
    private readonly drivers: DriversService,
    private readonly expiry: TripExpiryService,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  private async handle(event: TripEvent): Promise<void> {
    switch (event.type) {
      case 'requested':
        return this.sendRequest(event.tripId);
      case 'cancelled':
        return this.withdraw(event.tripId, 'PASSENGER_CANCELLED');
      case 'accepted':
        return this.withdraw(event.tripId, 'ACCEPTED_BY_ANOTHER_DRIVER', event.driverId);
      case 'expired':
        this.gateway.toUser(event.passengerId, 'trip:no_driver', { tripId: event.tripId });
        return this.withdraw(event.tripId, 'EXPIRED');
      default:
        return;
    }
  }

  /**
   * trip:request to every online Driver who is not on a trip, each with the
   * distance from their own last known position.
   */
  private async sendRequest(tripId: string): Promise<void> {
    const [trip, candidates] = await Promise.all([
      this.trips.findOne({ where: { id: tripId }, relations: { passenger: true } }),
      this.drivers.listDispatchCandidates(),
    ]);
    if (!trip) return;
    const expiresAt = this.expiry.expiresAt(trip.requestedAt);
    for (const { driverId, at } of candidates) {
      this.gateway.toUser(driverId, 'trip:request', toTripRequest(trip, at, expiresAt));
    }
  }

  /**
   * trip:withdrawn to Drivers so the alert disappears. Sent to every connected
   * Driver; one who never saw the request simply ignores an unknown tripId.
   */
  private withdraw(tripId: string, reason: WithdrawnReason, exceptDriverId?: string): void {
    this.gateway.toDrivers('trip:withdrawn', { tripId, reason }, exceptDriverId);
  }
}

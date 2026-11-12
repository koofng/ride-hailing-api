import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppEnv } from '../config/env.validation.js';
import { Trip } from './entities/trip.entity.js';
import { CancelReason, TripStatus } from './trip.enums.js';
import { TripEvents } from './trip-events.js';

/**
 * Trip requests are open to Drivers for TRIP_REQUEST_TTL_SECONDS. A trip no
 * Driver accepted in that time is cancelled with NO_DRIVER_FOUND, which frees
 * the Passenger to book again.
 *
 * Accepting and listing requests check the expiry themselves, so the
 * background sweep only has to catch up the trip's stored status.
 */
@Injectable()
export class TripExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripExpiryService.name);
  readonly ttlSeconds: number;
  private readonly sweepSeconds: number;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    config: ConfigService<AppEnv, true>,
    private readonly events: TripEvents,
  ) {
    this.ttlSeconds = config.get('TRIP_REQUEST_TTL_SECONDS', { infer: true });
    this.sweepSeconds = config.get('TRIP_EXPIRY_SWEEP_SECONDS', { infer: true });
  }

  onModuleInit(): void {
    if (this.sweepSeconds === 0) return;
    this.timer = setInterval(() => {
      this.expireStaleRequests().catch((error: unknown) =>
        this.logger.error(`Could not expire trip requests: ${String(error)}`),
      );
    }, this.sweepSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** When a request made at `requestedAt` stops being acceptable. */
  expiresAt(requestedAt: Date): Date {
    return new Date(requestedAt.getTime() + this.ttlSeconds * 1000);
  }

  /** Cancels every REQUESTED trip past its expiry. Returns the ids it cancelled. */
  async expireStaleRequests(): Promise<string[]> {
    const result = await this.trips
      .createQueryBuilder()
      .update(Trip)
      .set({
        status: TripStatus.CANCELLED,
        cancelReason: CancelReason.NO_DRIVER_FOUND,
        cancelledAt: () => 'now()',
      })
      .where('status = :requested', { requested: TripStatus.REQUESTED })
      .andWhere('requested_at <= now() - make_interval(secs => :ttl)', { ttl: this.ttlSeconds })
      .returning('id, passenger_id')
      .execute();
    const rows = result.raw as { id: string; passenger_id: string }[];
    if (rows.length) this.logger.log(`Expired ${rows.length} unaccepted trip request(s)`);
    for (const row of rows) {
      this.events.publish({ type: 'expired', tripId: row.id, passengerId: row.passenger_id });
    }
    return rows.map((row) => row.id);
  }
}

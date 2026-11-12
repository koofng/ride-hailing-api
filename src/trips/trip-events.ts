import { Injectable, Logger } from '@nestjs/common';
import { TripStatus } from './trip.enums.js';

/**
 * Something that happened to a trip, published after the database change is
 * committed. Listeners (WebSocket events now, push notifications later) turn
 * these into messages; the trip services never know who is listening.
 */
export type TripEvent =
  | { type: 'requested'; tripId: string; passengerId: string }
  | { type: 'cancelled'; tripId: string; passengerId: string }
  | { type: 'expired'; tripId: string; passengerId: string }
  | { type: 'accepted'; tripId: string; passengerId: string; driverId: string }
  | {
      type: 'progressed';
      tripId: string;
      passengerId: string;
      driverId: string;
      status: TripStatus.DRIVER_ARRIVED | TripStatus.IN_PROGRESS | TripStatus.COMPLETED;
    };

export type TripEventListener = (event: TripEvent) => void | Promise<void>;

@Injectable()
export class TripEvents {
  private readonly logger = new Logger(TripEvents.name);
  private readonly listeners: TripEventListener[] = [];

  subscribe(listener: TripEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Notifies every listener. A failing listener is logged and never affects
   * the request that published the event, or the other listeners.
   */
  publish(event: TripEvent): void {
    for (const listener of this.listeners) {
      try {
        Promise.resolve(listener(event)).catch((error: unknown) => this.report(event, error));
      } catch (error) {
        this.report(event, error);
      }
    }
  }

  private report(event: TripEvent, error: unknown): void {
    this.logger.error(`Listener failed for ${event.type} ${event.tripId}: ${String(error)}`);
  }
}

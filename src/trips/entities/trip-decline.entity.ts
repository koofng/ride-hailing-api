import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A Driver who declined a trip request no longer sees it or can accept it. */
@Entity({ name: 'trip_declines' })
export class TripDecline {
  @PrimaryColumn({ name: 'trip_id', type: 'uuid' })
  tripId: string;

  @PrimaryColumn({ name: 'driver_id', type: 'uuid' })
  driverId: string;

  @Column({ name: 'declined_at', type: 'timestamptz', default: () => 'now()' })
  declinedAt: Date;
}

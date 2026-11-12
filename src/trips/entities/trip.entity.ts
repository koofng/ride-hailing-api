import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation, ValueTransformer } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { CancelReason, PassengerCancelReason, TripStatus } from '../trip.enums.js';

/** Postgres returns `numeric` as a string to avoid precision loss; money here fits a double. */
const numeric: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * Spec: `Trip`. One active trip per Passenger (and per Driver) is enforced by
 * partial unique indexes in the migration, not only in code.
 */
@Entity({ name: 'trips' })
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'passenger_id', type: 'uuid' })
  passengerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'passenger_id', foreignKeyConstraintName: 'FK_trips_passenger' })
  passenger?: Relation<User>;

  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'driver_id', foreignKeyConstraintName: 'FK_trips_driver' })
  driver?: Relation<User> | null;

  @Column({ type: 'enum', enum: TripStatus, enumName: 'trip_status' })
  status: TripStatus;

  @Column({ name: 'origin_lat', type: 'double precision' })
  originLat: number;

  @Column({ name: 'origin_lng', type: 'double precision' })
  originLng: number;

  @Column({ name: 'origin_address', type: 'varchar', length: 255, nullable: true })
  originAddress: string | null;

  @Column({ name: 'destination_lat', type: 'double precision' })
  destinationLat: number;

  @Column({ name: 'destination_lng', type: 'double precision' })
  destinationLng: number;

  @Column({ name: 'destination_address', type: 'varchar', length: 255, nullable: true })
  destinationAddress: string | null;

  /** Stored per trip, so a later fare change never rewrites history. */
  @Column({ name: 'fare_amount', type: 'numeric', precision: 10, scale: 2, transformer: numeric })
  fareAmount: number;

  @Column({ name: 'fare_currency', type: 'char', length: 3 })
  fareCurrency: string;

  @Column({ name: 'cancel_reason', type: 'enum', enum: CancelReason, enumName: 'trip_cancel_reason', nullable: true })
  cancelReason: CancelReason | null;

  @Column({
    name: 'passenger_cancel_reason',
    type: 'enum',
    enum: PassengerCancelReason,
    enumName: 'trip_passenger_cancel_reason',
    nullable: true,
  })
  passengerCancelReason: PassengerCancelReason | null;

  @Column({ name: 'cancel_note', type: 'varchar', length: 500, nullable: true })
  cancelNote: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'arrived_at', type: 'timestamptz', nullable: true })
  arrivedAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;
}

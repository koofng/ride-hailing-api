import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, Unique } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity.js';

/**
 * Driver onboarding data (spec: `DriverDetails` + `Vehicle`). Shares its
 * primary key with `users`, so a user has at most one row here.
 */
@Entity({ name: 'driver_details' })
@Unique('UQ_driver_details_plate_number', ['plateNumber'])
export class DriverDetails {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, (user) => user.driverDetails, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_driver_details_user' })
  user: Relation<User>;

  @Column({ name: 'licence_number', type: 'varchar', length: 50 })
  licenceNumber: string;

  /**
   * Storage keys (not URLs) for the licence image and insurance document.
   * These are private documents and are never served publicly.
   */
  @Column({ name: 'licence_image_key', type: 'text' })
  licenceImageKey: string;

  @Column({ name: 'insurance_document_key', type: 'text' })
  insuranceDocumentKey: string;

  @Column({ name: 'vehicle_make', type: 'varchar', length: 50 })
  vehicleMake: string;

  @Column({ name: 'vehicle_model', type: 'varchar', length: 50 })
  vehicleModel: string;

  @Column({ name: 'vehicle_colour', type: 'varchar', length: 30 })
  vehicleColour: string;

  /** Stored upper-cased so "abc 123" and "ABC 123" count as the same plate. */
  @Column({ name: 'plate_number', type: 'varchar', length: 15 })
  plateNumber: string;

  @Column({ type: 'boolean', default: false })
  available: boolean;
}

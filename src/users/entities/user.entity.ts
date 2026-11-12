import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Role } from '../role.enum.js';
import { DriverDetails } from './driver-details.entity.js';

/**
 * One account table for both roles (spec: `UserProfile`). Driver-only data
 * lives in `driver_details`, which exists exactly when `role` is DRIVER.
 */
@Entity({ name: 'users' })
@Unique('UQ_users_email', ['email'])
@Unique('UQ_users_phone', ['phone'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: Role, enumName: 'user_role' })
  role: Role;

  @Column({ name: 'full_name', type: 'varchar', length: 100 })
  fullName: string;

  /** Stored lower-cased so uniqueness and login are case-insensitive. */
  @Column({ type: 'varchar', length: 254 })
  email: string;

  /** E.164, e.g. +19025551234 */
  @Column({ type: 'varchar', length: 16 })
  phone: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 100, select: false })
  passwordHash: string;

  /** Storage key, e.g. `public/photos/<uuid>.jpg`. Exposed only as a signed URL. */
  @Column({ name: 'photo_key', type: 'text', nullable: true })
  photoKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DriverDetails, (details) => details.user)
  driverDetails?: Relation<DriverDetails> | null;
}

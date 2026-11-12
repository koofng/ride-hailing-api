import type { DataSourceOptions } from 'typeorm';
import { RevokedToken } from '../auth/entities/revoked-token.entity.js';
import type { AppEnv } from '../config/env.validation.js';
import { DriverDetails } from '../users/entities/driver-details.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateUsersAndAuth1794355200000 } from './migrations/1794355200000-CreateUsersAndAuth.js';
import { StorePhotoKeyInsteadOfUrl1794528000000 } from './migrations/1794528000000-StorePhotoKeyInsteadOfUrl.js';
import { CreateTrips1794600000000 } from './migrations/1794600000000-CreateTrips.js';
import { CreateTripDeclines1794700000000 } from './migrations/1794700000000-CreateTripDeclines.js';
import { AddDriverLocation1794800000000 } from './migrations/1794800000000-AddDriverLocation.js';
import { TripDecline } from '../trips/entities/trip-decline.entity.js';
import { Trip } from '../trips/entities/trip.entity.js';

/**
 * Entities and migrations are listed explicitly (not globbed) so the same
 * config works from compiled `dist/` and from TypeScript under Vitest.
 * The schema is managed only by migrations; `synchronize` stays off.
 */
export type DbEnv = Pick<AppEnv, 'DB_HOST' | 'DB_PORT' | 'DB_USER' | 'DB_PASSWORD' | 'DB_NAME'>;

export function buildTypeOrmOptions(env: DbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [User, DriverDetails, RevokedToken, Trip, TripDecline],
    migrations: [
      CreateUsersAndAuth1794355200000,
      StorePhotoKeyInsteadOfUrl1794528000000,
      CreateTrips1794600000000,
      CreateTripDeclines1794700000000,
      AddDriverLocation1794800000000,
    ],
    migrationsRun: true,
    synchronize: false,
    // UUIDs come from Postgres's built-in gen_random_uuid() (PG 13+),
    // so no extension needs installing.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}

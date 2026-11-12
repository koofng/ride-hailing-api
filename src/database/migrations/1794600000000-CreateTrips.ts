import type { MigrationInterface, QueryRunner } from 'typeorm';

const ACTIVE = `('REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS')`;

export class CreateTrips1794600000000 implements MigrationInterface {
  name = 'CreateTrips1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "trip_status" AS ENUM
        ('REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
    `);
    await queryRunner.query(
      `CREATE TYPE "trip_cancel_reason" AS ENUM ('PASSENGER_CANCELLED', 'NO_DRIVER_FOUND')`,
    );
    await queryRunner.query(`
      CREATE TYPE "trip_passenger_cancel_reason" AS ENUM
        ('CHANGED_MIND', 'WAIT_TOO_LONG', 'BOOKED_BY_MISTAKE', 'OTHER')
    `);

    await queryRunner.query(`
      CREATE TABLE "trips" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "passenger_id" uuid NOT NULL,
        "driver_id" uuid,
        "status" "trip_status" NOT NULL,
        "origin_lat" double precision NOT NULL,
        "origin_lng" double precision NOT NULL,
        "origin_address" varchar(255),
        "destination_lat" double precision NOT NULL,
        "destination_lng" double precision NOT NULL,
        "destination_address" varchar(255),
        "fare_amount" numeric(10, 2) NOT NULL,
        "fare_currency" char(3) NOT NULL,
        "cancel_reason" "trip_cancel_reason",
        "passenger_cancel_reason" "trip_passenger_cancel_reason",
        "cancel_note" varchar(500),
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "accepted_at" timestamptz,
        "arrived_at" timestamptz,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "cancelled_at" timestamptz,
        CONSTRAINT "PK_trips" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trips_passenger" FOREIGN KEY ("passenger_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trips_driver" FOREIGN KEY ("driver_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_trips_cancelled" CHECK (
          ("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL)
        ),
        CONSTRAINT "CHK_trips_passenger_cancel_reason" CHECK (
          "passenger_cancel_reason" IS NULL OR "cancel_reason" = 'PASSENGER_CANCELLED'
        ),
        CONSTRAINT "CHK_trips_fare" CHECK ("fare_amount" >= 0)
      )
    `);

    // One active trip per Passenger and per Driver, enforced by the database
    // so two concurrent bookings cannot both succeed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trips_passenger_active" ON "trips" ("passenger_id")
      WHERE "status" IN ${ACTIVE}
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trips_driver_active" ON "trips" ("driver_id")
      WHERE "driver_id" IS NOT NULL AND "status" IN ${ACTIVE}
    `);

    // Trip history, newest first.
    await queryRunner.query(
      `CREATE INDEX "IDX_trips_passenger_requested_at" ON "trips" ("passenger_id", "requested_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trips_driver_requested_at" ON "trips" ("driver_id", "requested_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trips"`);
    await queryRunner.query(`DROP TYPE "trip_passenger_cancel_reason"`);
    await queryRunner.query(`DROP TYPE "trip_cancel_reason"`);
    await queryRunner.query(`DROP TYPE "trip_status"`);
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A Driver's last known position, used to show online Drivers on the
 * Passenger's map. Recorded only while the Driver is online and cleared when
 * they go offline, so offline Drivers are never tracked.
 */
export class AddDriverLocation1794800000000 implements MigrationInterface {
  name = 'AddDriverLocation1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "driver_details"
        ADD "last_lat" double precision,
        ADD "last_lng" double precision,
        ADD "location_updated_at" timestamptz,
        ADD CONSTRAINT "CHK_driver_details_location" CHECK (
          ("last_lat" IS NULL) = ("last_lng" IS NULL)
          AND ("last_lat" IS NULL) = ("location_updated_at" IS NULL)
        )
    `);
    // The map query only ever looks at online Drivers.
    await queryRunner.query(`
      CREATE INDEX "IDX_driver_details_online" ON "driver_details" ("location_updated_at")
      WHERE "available" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_driver_details_online"`);
    await queryRunner.query(`
      ALTER TABLE "driver_details"
        DROP CONSTRAINT "CHK_driver_details_location",
        DROP COLUMN "location_updated_at",
        DROP COLUMN "last_lng",
        DROP COLUMN "last_lat"
    `);
  }
}

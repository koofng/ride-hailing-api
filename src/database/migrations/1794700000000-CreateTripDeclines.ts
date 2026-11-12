import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTripDeclines1794700000000 implements MigrationInterface {
  name = 'CreateTripDeclines1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_declines" (
        "trip_id" uuid NOT NULL,
        "driver_id" uuid NOT NULL,
        "declined_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_declines" PRIMARY KEY ("trip_id", "driver_id"),
        CONSTRAINT "FK_trip_declines_trip" FOREIGN KEY ("trip_id")
          REFERENCES "trips" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_declines_driver" FOREIGN KEY ("driver_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trip_declines"`);
  }
}

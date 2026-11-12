import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndAuth1794355200000 implements MigrationInterface {
  name = 'CreateUsersAndAuth1794355200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('PASSENGER', 'DRIVER')`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "role" "user_role" NOT NULL,
        "full_name" varchar(100) NOT NULL,
        "email" varchar(254) NOT NULL,
        "phone" varchar(16) NOT NULL,
        "password_hash" varchar(100) NOT NULL,
        "photo_url" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_phone" UNIQUE ("phone")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "driver_details" (
        "user_id" uuid NOT NULL,
        "licence_number" varchar(50) NOT NULL,
        "licence_image_key" text NOT NULL,
        "insurance_document_key" text NOT NULL,
        "vehicle_make" varchar(50) NOT NULL,
        "vehicle_model" varchar(50) NOT NULL,
        "vehicle_colour" varchar(30) NOT NULL,
        "plate_number" varchar(15) NOT NULL,
        "available" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_driver_details" PRIMARY KEY ("user_id"),
        CONSTRAINT "UQ_driver_details_plate_number" UNIQUE ("plate_number"),
        CONSTRAINT "FK_driver_details_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "revoked_tokens" (
        "jti" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "PK_revoked_tokens" PRIMARY KEY ("jti")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_revoked_tokens_expires_at" ON "revoked_tokens" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "revoked_tokens"`);
    await queryRunner.query(`DROP TABLE "driver_details"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
  }
}

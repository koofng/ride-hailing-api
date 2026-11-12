import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile photos are no longer public, so a fixed URL cannot be stored.
 * Store the storage key and sign a short-lived URL per response instead.
 * Existing values look like `<base>/uploads/photos/<uuid>.jpg` and map to
 * the key `public/photos/<uuid>.jpg` (the file itself does not move).
 */
export class StorePhotoKeyInsteadOfUrl1794528000000 implements MigrationInterface {
  name = 'StorePhotoKeyInsteadOfUrl1794528000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "photo_key" text`);
    await queryRunner.query(`
      UPDATE "users"
      SET "photo_key" = 'public/' || substring("photo_url" from '/uploads/(photos/[^/]+)$')
      WHERE "photo_url" IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "photo_url"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const baseUrl = (
      process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    ).replace(/\/+$/, '');
    await queryRunner.query(`ALTER TABLE "users" ADD "photo_url" text`);
    await queryRunner.query(
      `
      UPDATE "users"
      SET "photo_url" = $1 || '/uploads/' || substring("photo_key" from '^public/(.+)$')
      WHERE "photo_key" IS NOT NULL
    `,
      [baseUrl],
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "photo_key"`);
  }
}

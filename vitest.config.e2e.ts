import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// The compose `mongo` service; a separate database keeps test files apart.
const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ?? 'mongodb://localhost:27018/ride_hailing_test';

// End-to-end tests: boot the full Nest app against a real PostgreSQL database
// (the `ride_hailing_test` database created by docker/postgres/init).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DB_HOST: process.env.DB_HOST ?? 'localhost',
      DB_PORT: process.env.DB_PORT ?? '5433',
      DB_USER: process.env.DB_USER ?? 'ride_hailing',
      DB_PASSWORD: process.env.DB_PASSWORD ?? 'ride_hailing',
      DB_NAME: process.env.TEST_DB_NAME ?? 'ride_hailing_test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      JWT_EXPIRES_IN_SECONDS: '86400',
      BCRYPT_ROUNDS: '4',
      UPLOAD_DIR: join(tmpdir(), 'ride-hailing-e2e-uploads'),
      PUBLIC_BASE_URL: 'http://localhost:3000',
      // `npm run test:e2e:gridfs` runs the same suite with uploads in GridFS.
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'disk',
      MONGODB_URI: TEST_MONGODB_URI,
      TEST_MONGODB_URI,
      TRIP_REQUEST_TTL_SECONDS: '120',
      // Tests run the expiry check themselves, so a timer cannot change their data.
      TRIP_EXPIRY_SWEEP_SECONDS: '0',
    },
  },
});

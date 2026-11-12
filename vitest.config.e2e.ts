import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

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
    },
  },
});

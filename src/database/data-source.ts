import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation.js';
import { buildTypeOrmOptions } from './typeorm-options.js';

/**
 * Used by the TypeORM CLI (`npm run migration:*`). The app itself runs
 * pending migrations on startup.
 */
try {
  // Load .env when present; real environment variables still take precedence.
  process.loadEnvFile('.env');
} catch {
  // No .env file (e.g. in a container): rely on the environment.
}

const env = validateEnv(process.env);

export default new DataSource({ ...buildTypeOrmOptions(env), migrationsRun: false });

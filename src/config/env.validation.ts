/**
 * Validates environment variables once at startup so a misconfigured server
 * fails immediately instead of on the first request.
 */
export interface AppEnv {
  NODE_ENV: string;
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN_SECONDS: number;
  BCRYPT_ROUNDS: number;
  UPLOAD_DIR: string;
  PUBLIC_BASE_URL: string;
  FILE_URL_TTL_SECONDS: number;
  STORAGE_DRIVER: StorageDriver;
  /** Set only when STORAGE_DRIVER is gridfs. */
  MONGODB_URI: string | undefined;
}

/** Where uploaded files are kept: local disk (default) or MongoDB GridFS. */
export type StorageDriver = 'disk' | 'gridfs';
const STORAGE_DRIVERS: readonly StorageDriver[] = ['disk', 'gridfs'];

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const errors: string[] = [];

  const str = (key: string, fallback?: string): string => {
    const value = raw[key] === undefined || raw[key] === '' ? fallback : raw[key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} is required`);
      return '';
    }
    return value.trim();
  };

  const int = (key: string, fallback: number, min: number, max: number) => {
    const value = raw[key];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      errors.push(`${key} must be an integer between ${min} and ${max}`);
    }
    return parsed;
  };

  const port = int('PORT', 3000, 1, 65535);

  const env: AppEnv = {
    NODE_ENV: str('NODE_ENV', 'development'),
    PORT: port,
    DB_HOST: str('DB_HOST'),
    DB_PORT: int('DB_PORT', 5432, 1, 65535),
    DB_USER: str('DB_USER'),
    DB_PASSWORD: str('DB_PASSWORD'),
    DB_NAME: str('DB_NAME'),
    JWT_SECRET: str('JWT_SECRET'),
    JWT_EXPIRES_IN_SECONDS: int('JWT_EXPIRES_IN_SECONDS', 86400, 60, 2_592_000),
    BCRYPT_ROUNDS: int('BCRYPT_ROUNDS', 12, 4, 15),
    UPLOAD_DIR: str('UPLOAD_DIR', 'uploads'),
    // The address clients use to reach the API, for signed photo links. Set
    // PUBLIC_BASE_URL for a custom domain or proxy; on Render it defaults to
    // the service's public URL (RENDER_EXTERNAL_URL, set by Render); locally,
    // to this server on PORT.
    PUBLIC_BASE_URL: str(
      'PUBLIC_BASE_URL',
      nonEmpty(raw.RENDER_EXTERNAL_URL) ?? `http://localhost:${port}`,
    ).replace(/\/+$/, ''),
    FILE_URL_TTL_SECONDS: int('FILE_URL_TTL_SECONDS', 900, 60, 86_400),
    STORAGE_DRIVER: storageDriver(raw.STORAGE_DRIVER, errors),
    MONGODB_URI: undefined,
  };

  if (env.STORAGE_DRIVER === 'gridfs') {
    env.MONGODB_URI = mongoUri(raw.MONGODB_URI, errors);
  }

  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return env;
}

function storageDriver(value: unknown, errors: string[]): StorageDriver {
  if (value === undefined || value === '') return 'disk';
  const driver = String(value).trim().toLowerCase();
  if (!STORAGE_DRIVERS.includes(driver as StorageDriver)) {
    errors.push(`STORAGE_DRIVER must be one of: ${STORAGE_DRIVERS.join(', ')}`);
    return 'disk';
  }
  return driver as StorageDriver;
}

/** A MongoDB connection string that names its database, e.g. mongodb+srv://…/ride_hailing */
function mongoUri(value: unknown, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push('MONGODB_URI is required when STORAGE_DRIVER is gridfs');
    return undefined;
  }
  const uri = value.trim();
  let database = '';
  try {
    const url = new URL(uri);
    if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') throw new Error();
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    errors.push('MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string');
    return undefined;
  }
  if (!database) {
    errors.push('MONGODB_URI must include a database name, e.g. mongodb+srv://user:pass@host/ride_hailing');
  }
  return uri;
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

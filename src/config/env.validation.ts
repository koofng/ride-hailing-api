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
}

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
    // Defaults to this server on PORT. Set it only when clients reach the API
    // at a different address (a domain, a proxy or a mapped Docker port).
    PUBLIC_BASE_URL: str('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    FILE_URL_TTL_SECONDS: int('FILE_URL_TTL_SECONDS', 900, 60, 86_400),
  };

  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return env;
}

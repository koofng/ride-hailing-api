import { validateEnv } from './env.validation.js';

const base = {
  DB_HOST: 'localhost',
  DB_USER: 'ride_hailing',
  DB_PASSWORD: 'ride_hailing',
  DB_NAME: 'ride_hailing',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
};

describe('validateEnv PUBLIC_BASE_URL', () => {
  it('defaults to localhost on PORT', () => {
    expect(validateEnv({ ...base, PORT: '3001' }).PUBLIC_BASE_URL).toBe('http://localhost:3001');
  });

  it('defaults to localhost:3000 when PORT is not set either', () => {
    expect(validateEnv(base).PUBLIC_BASE_URL).toBe('http://localhost:3000');
  });

  it('uses an explicit value over PORT, without a trailing slash', () => {
    const env = validateEnv({ ...base, PORT: '3001', PUBLIC_BASE_URL: 'https://api.example.com/' });
    expect(env.PUBLIC_BASE_URL).toBe('https://api.example.com');
  });

  it("defaults to Render's public URL when running on Render", () => {
    const env = validateEnv({ ...base, PORT: '10000', RENDER_EXTERNAL_URL: 'https://ride-hailing-api.onrender.com' });
    expect(env.PUBLIC_BASE_URL).toBe('https://ride-hailing-api.onrender.com');
  });

  it('an explicit PUBLIC_BASE_URL wins over the Render URL (custom domain)', () => {
    const env = validateEnv({
      ...base,
      RENDER_EXTERNAL_URL: 'https://ride-hailing-api.onrender.com',
      PUBLIC_BASE_URL: 'https://api.example.com',
    });
    expect(env.PUBLIC_BASE_URL).toBe('https://api.example.com');
  });

  it('falls back to localhost when RENDER_EXTERNAL_URL is empty', () => {
    expect(validateEnv({ ...base, PORT: '3001', RENDER_EXTERNAL_URL: ' ' }).PUBLIC_BASE_URL).toBe(
      'http://localhost:3001',
    );
  });

  it('treats an empty value as unset', () => {
    expect(validateEnv({ ...base, PORT: '4000', PUBLIC_BASE_URL: '' }).PUBLIC_BASE_URL).toBe(
      'http://localhost:4000',
    );
  });
});

describe('validateEnv storage', () => {
  it('defaults to disk storage and needs no MongoDB', () => {
    const env = validateEnv(base);
    expect(env.STORAGE_DRIVER).toBe('disk');
    expect(env.MONGODB_URI).toBeUndefined();
  });

  it('accepts gridfs with a connection string that names a database', () => {
    const uri = 'mongodb+srv://app:secret@cluster0.abcde.mongodb.net/ride_hailing?retryWrites=true&w=majority';
    const env = validateEnv({ ...base, STORAGE_DRIVER: 'GridFS', MONGODB_URI: uri });
    expect(env.STORAGE_DRIVER).toBe('gridfs');
    expect(env.MONGODB_URI).toBe(uri);
  });

  it('ignores MONGODB_URI when storage is on disk', () => {
    expect(validateEnv({ ...base, MONGODB_URI: 'nonsense' }).MONGODB_URI).toBeUndefined();
  });

  it.each([
    [{ STORAGE_DRIVER: 's3' }, 'STORAGE_DRIVER must be one of: disk, gridfs'],
    [{ STORAGE_DRIVER: 'gridfs' }, 'MONGODB_URI is required when STORAGE_DRIVER is gridfs'],
    [{ STORAGE_DRIVER: 'gridfs', MONGODB_URI: 'postgres://x/y' }, 'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string'],
    [
      { STORAGE_DRIVER: 'gridfs', MONGODB_URI: 'mongodb+srv://app:secret@cluster0.abcde.mongodb.net/?retryWrites=true' },
      'MONGODB_URI must include a database name',
    ],
  ])('rejects %j', (overrides, message) => {
    expect(() => validateEnv({ ...base, ...overrides })).toThrow(message);
  });
});

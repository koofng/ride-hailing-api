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

  it('treats an empty value as unset', () => {
    expect(validateEnv({ ...base, PORT: '4000', PUBLIC_BASE_URL: '' }).PUBLIC_BASE_URL).toBe(
      'http://localhost:4000',
    );
  });
});

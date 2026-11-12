import type { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv } from '../config/env.validation.js';
import { DiskFileStore } from './disk-file-store.js';
import { StorageService } from './storage.service.js';

const NAME = '3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11.jpg';
const KEY = `public/photos/${NAME}`;
const TTL = 900;
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

let root: string;

const makeStorage = (secret = 'test-secret-that-is-at-least-32-characters-long') => {
  const env: Record<string, unknown> = {
    PUBLIC_BASE_URL: 'http://localhost:3000',
    FILE_URL_TTL_SECONDS: TTL,
    JWT_SECRET: secret,
  };
  return new StorageService(
    { get: (key: string) => env[key] } as unknown as ConfigService<AppEnv, true>,
    new DiskFileStore(root),
  );
};

/** Splits a signed URL into the arguments the files endpoint receives. */
const parts = (url: string) => {
  const u = new URL(url);
  return {
    path: u.pathname,
    name: u.pathname.split('/').pop()!,
    expires: u.searchParams.get('expires')!,
    sig: u.searchParams.get('sig')!,
  };
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'storage-spec-'));
  await mkdir(join(root, 'public/photos'), { recursive: true });
  await writeFile(join(root, KEY), Buffer.from([0xff, 0xd8, 0xff]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('StorageService.signedPhotoUrl', () => {
  const storage = () => makeStorage();

  it('points at the files endpoint with an expiry and signature', () => {
    const { path, expires, sig } = parts(storage().signedPhotoUrl(KEY, NOW));
    expect(path).toBe(`/api/files/photos/${NAME}`);
    expect(Number(expires)).toBeGreaterThan(NOW / 1000);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stays valid for at least one TTL and at most two', () => {
    const expires = Number(parts(storage().signedPhotoUrl(KEY, NOW)).expires);
    expect(expires - NOW / 1000).toBeGreaterThan(TTL);
    expect(expires - NOW / 1000).toBeLessThanOrEqual(2 * TTL);
  });

  it('returns the same URL within one window, so clients can cache the image', () => {
    const windowStart = Math.floor(NOW / 1000 / TTL) * TTL * 1000;
    const s = storage();
    expect(s.signedPhotoUrl(KEY, windowStart)).toBe(s.signedPhotoUrl(KEY, windowStart + TTL * 1000 - 1));
  });

  it.each([
    'private/driver-documents/a.pdf',
    'public/photos/../../private/driver-documents/a.pdf',
    'public/photos/not-a-uuid.jpg',
    'public/other/3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11.jpg',
  ])('refuses to sign anything but a profile photo: %s', (key) => {
    expect(() => storage().signedPhotoUrl(key, NOW)).toThrow();
  });
});

describe('StorageService.openSignedPhoto', () => {
  it('opens the photo for a genuine, unexpired link', async () => {
    const s = makeStorage();
    const { name, expires, sig } = parts(s.signedPhotoUrl(KEY, NOW));
    const file = await s.openSignedPhoto(name, expires, sig, NOW);
    expect(file).toMatchObject({ size: 3, contentType: 'image/jpeg' });
    file!.stream.destroy();
  });

  it('rejects an expired link', async () => {
    const s = makeStorage();
    const { name, expires, sig } = parts(s.signedPhotoUrl(KEY, NOW));
    expect(await s.openSignedPhoto(name, expires, sig, Number(expires) * 1000)).toBeNull();
  });

  it('rejects a link whose expiry was pushed back', async () => {
    const s = makeStorage();
    const { name, expires, sig } = parts(s.signedPhotoUrl(KEY, NOW));
    expect(await s.openSignedPhoto(name, String(Number(expires) + 86_400), sig, NOW)).toBeNull();
  });

  it('rejects a signature made for another photo', async () => {
    const s = makeStorage();
    const other = 'aaaaaaaa-8d4e-4f0a-9b1c-2e7d5a9c4f11.jpg';
    const { expires, sig } = parts(s.signedPhotoUrl(`public/photos/${other}`, NOW));
    expect(await s.openSignedPhoto(NAME, expires, sig, NOW)).toBeNull();
  });

  it('rejects a link signed with a different secret', async () => {
    const forger = makeStorage('another-secret-that-is-at-least-32-characters');
    const { name, expires, sig } = parts(forger.signedPhotoUrl(KEY, NOW));
    expect(await makeStorage().openSignedPhoto(name, expires, sig, NOW)).toBeNull();
  });

  it.each([
    ['missing signature', NAME, '9999999999', undefined],
    ['missing expiry', NAME, undefined, 'x'],
    ['repeated query parameters', NAME, ['9999999999', '1'], 'x'],
    ['path traversal', '../../private/driver-documents/a.pdf', '9999999999', 'x'],
  ])('rejects %s', async (_label, name, expires, sig) => {
    expect(await makeStorage().openSignedPhoto(name, expires, sig, NOW)).toBeNull();
  });

  it('returns null for a validly signed link to a deleted photo', async () => {
    const s = makeStorage();
    const gone = 'bbbbbbbb-8d4e-4f0a-9b1c-2e7d5a9c4f11.png';
    const { expires, sig } = parts(s.signedPhotoUrl(`public/photos/${gone}`, NOW));
    expect(await s.openSignedPhoto(gone, expires, sig, NOW)).toBeNull();
  });
});

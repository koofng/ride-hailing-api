import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.validation.js';
import { StorageService } from './storage.service.js';

const config = {
  get: (key: string) =>
    ({ UPLOAD_DIR: '/tmp/uploads', PUBLIC_BASE_URL: 'http://localhost:3000' })[key],
} as unknown as ConfigService<AppEnv, true>;

describe('StorageService.keyFromPublicUrl', () => {
  const storage = new StorageService(config);

  it('is the reverse of publicUrl', () => {
    const key = 'public/photos/3f6c1b2a.jpg';
    expect(storage.keyFromPublicUrl(storage.publicUrl(key))).toBe(key);
  });

  it.each([
    ['another host', 'https://cdn.example.com/uploads/photos/a.jpg'],
    ['a path outside /uploads', 'http://localhost:3000/photos/a.jpg'],
    ['path traversal', 'http://localhost:3000/uploads/../private/driver-documents/a.pdf'],
    ['nested traversal', 'http://localhost:3000/uploads/photos/../../private/a.pdf'],
    ['an empty path', 'http://localhost:3000/uploads/'],
    ['an empty segment', 'http://localhost:3000/uploads/photos//a.jpg'],
  ])('returns null for %s', (_label, url) => {
    expect(storage.keyFromPublicUrl(url)).toBeNull();
  });
});

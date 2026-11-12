import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('200 without a token when Postgres and file storage are reachable', async () => {
    const res = await ctx.http().get('/api/health').expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'OK',
      data: { status: 'ok', database: 'up', storage: 'up' },
    });
  });

  it('ignores an invalid token (it is public)', async () => {
    await ctx.http().get('/api/health').set('Authorization', 'Bearer not-a-jwt').expect(200);
  });

  it('503 when the file storage is unreachable', async () => {
    vi.spyOn(ctx.app.get(StorageService), 'ping').mockRejectedValueOnce(new Error('connection refused'));
    const res = await ctx.http().get('/api/health').expect(503);
    expect(res.body).toEqual({
      success: false,
      message: 'Service unavailable: file storage not reachable',
      error: { statusCode: 503, status: 'Service Unavailable' },
    });
  });

  it('503 naming both when the database and storage are down', async () => {
    vi.spyOn(ctx.app.get(DataSource), 'query').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.spyOn(ctx.app.get(StorageService), 'ping').mockRejectedValueOnce(new Error('timeout'));
    const res = await ctx.http().get('/api/health').expect(503);
    expect(res.body.message).toBe('Service unavailable: database and file storage not reachable');
  });

  it('503 when a check hangs, after the 3 second timeout', async () => {
    vi.spyOn(ctx.app.get(StorageService), 'ping').mockReturnValueOnce(new Promise(() => {}));
    const started = Date.now();
    await ctx.http().get('/api/health').expect(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  }, 10_000);
});

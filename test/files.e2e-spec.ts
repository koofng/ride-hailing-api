import {
  clearUploads,
  createTestApp,
  driverFields,
  passengerBody,
  pathOf,
  registerDriver,
  resetDatabase,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx?.app.close();
});

beforeEach(async () => {
  await resetDatabase(ctx.db);
  await clearUploads();
});

const FORBIDDEN = {
  success: false,
  message: 'This link is invalid or has expired',
  error: { statusCode: 403, status: 'Forbidden' },
};

/** Registers a Driver (who has a photo) and returns their signed photo URL. */
const driverPhotoUrl = async (overrides: Record<string, string> = {}) => {
  const res = await registerDriver(ctx, driverFields(overrides)).expect(201);
  return res.body.data.user.photoUrl as string;
};

const withQuery = (url: string, change: (q: URLSearchParams) => void) => {
  const u = new URL(url);
  change(u.searchParams);
  return u.pathname + '?' + u.searchParams.toString();
};

describe('GET /api/files/photos/:name', () => {
  it('serves the photo for a signed link, without a token', async () => {
    const url = await driverPhotoUrl();
    const res = await ctx.http().get(pathOf(url)).expect(200);

    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it('403: no signature', async () => {
    const url = await driverPhotoUrl();
    const res = await ctx.http().get(new URL(url).pathname).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('403: tampered signature', async () => {
    const url = await driverPhotoUrl();
    const flip = (sig: string) => (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const path = withQuery(url, (q) => q.set('sig', flip(q.get('sig')!)));
    const res = await ctx.http().get(path).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('403: expiry pushed into the future', async () => {
    const url = await driverPhotoUrl();
    const path = withQuery(url, (q) => q.set('expires', String(Number(q.get('expires')) + 86_400)));
    await ctx.http().get(path).expect(403);
  });

  it("403: one user's signature cannot unlock another user's photo", async () => {
    const mine = await driverPhotoUrl();
    const theirs = await driverPhotoUrl({
      email: 'other@example.com',
      phone: '+19025550001',
      plateNumber: 'XYZ 999',
    });
    const forged = new URL(theirs).pathname + new URL(mine).search;
    await ctx.http().get(forged).expect(403);
  });

  it('403: the same answer for a photo that does not exist', async () => {
    const res = await ctx
      .http()
      .get('/api/files/photos/3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11.jpg?expires=9999999999&sig=x')
      .expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('cannot reach driver documents through path tricks', async () => {
    await registerDriver(ctx).expect(201);
    const [row] = await ctx.db.query('SELECT licence_image_key FROM driver_details');
    const file = row.licence_image_key.split('/').pop();

    for (const path of [
      `/api/files/photos/..%2F..%2Fprivate%2Fdriver-documents%2F${file}?expires=9999999999&sig=x`,
      `/api/files/photos/%2E%2E%2F%2E%2E%2Fprivate%2Fdriver-documents%2F${file}?expires=9999999999&sig=x`,
    ]) {
      const res = await ctx.http().get(path);
      expect([403, 404]).toContain(res.status);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    }
  });
});

describe('uploads are not served as static files', () => {
  it('404 for the old public /uploads paths, photos and documents alike', async () => {
    const url = await driverPhotoUrl();
    const name = new URL(url).pathname.split('/').pop();
    const [row] = await ctx.db.query(
      'SELECT licence_image_key, insurance_document_key FROM driver_details',
    );

    await ctx.http().get(`/uploads/photos/${name}`).expect(404);
    await ctx.http().get(`/uploads/public/photos/${name}`).expect(404);
    await ctx.http().get(`/uploads/${row.licence_image_key}`).expect(404);
    await ctx.http().get(`/uploads/${row.insurance_document_key}`).expect(404);
  });

  it('a Passenger without a photo has no file URL at all', async () => {
    const res = await ctx
      .http()
      .post('/api/auth/register/passenger')
      .send(passengerBody())
      .expect(201);
    expect(res.body.data.user.photoUrl).toBeNull();
  });
});

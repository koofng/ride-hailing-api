import { TripExpiryService } from '../src/trips/trip-expiry.service.js';
import {
  bearer,
  clearUploads,
  createTestApp,
  resetDatabase,
  signUpDriver,
  signUpPassenger,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let expiry: TripExpiryService;

beforeAll(async () => {
  ctx = await createTestApp();
  expiry = ctx.app.get(TripExpiryService);
});

afterAll(async () => {
  await ctx?.app.close();
});

beforeEach(async () => {
  await resetDatabase(ctx.db);
  await clearUploads();
});

const tripBody = {
  origin: { lat: 45.6169, lng: -61.9986 },
  destination: { lat: 45.6175, lng: -61.9933 },
};

/** Books a trip and backdates it by `ageSeconds`. */
const bookTrip = async (token: string, ageSeconds: number): Promise<string> => {
  const { body } = await ctx.http().post('/api/trips').set(bearer(token)).send(tripBody).expect(201);
  await ctx.db.query(
    `UPDATE trips SET requested_at = now() - make_interval(secs => $2) WHERE id = $1`,
    [body.data.id, ageSeconds],
  );
  return body.data.id;
};

describe('trip request expiry', () => {
  it('uses TRIP_REQUEST_TTL_SECONDS (120 in tests)', () => {
    expect(expiry.ttlSeconds).toBe(120);
    expect(expiry.expiresAt(new Date('2026-11-12T10:00:00Z')).toISOString()).toBe('2026-11-12T10:02:00.000Z');
  });

  it('cancels a REQUESTED trip older than the TTL with NO_DRIVER_FOUND', async () => {
    const passenger = await signUpPassenger(ctx);
    const id = await bookTrip(passenger.token, 121);

    expect(await expiry.expireStaleRequests()).toEqual([id]);

    const { body } = await ctx.http().get(`/api/trips/${id}`).set(bearer(passenger.token)).expect(200);
    expect(body.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'NO_DRIVER_FOUND',
      cancelDetails: null,
      cancelledAt: expect.any(String),
    });
  });

  it('frees the Passenger to book again', async () => {
    const passenger = await signUpPassenger(ctx);
    await bookTrip(passenger.token, 300);
    await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(tripBody).expect(409);

    await expiry.expireStaleRequests();
    await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(tripBody).expect(201);
  });

  it('leaves requests still inside the TTL alone', async () => {
    const passenger = await signUpPassenger(ctx);
    await bookTrip(passenger.token, 100);
    expect(await expiry.expireStaleRequests()).toEqual([]);
    const [row] = await ctx.db.query('SELECT status FROM trips');
    expect(row.status).toBe('REQUESTED');
  });

  it('never touches accepted trips, however old', async () => {
    const passenger = await signUpPassenger(ctx);
    const driver = await signUpDriver(ctx);
    const id = await bookTrip(passenger.token, 3600);
    await ctx.db.query(
      `UPDATE trips SET status = 'ACCEPTED', driver_id = $2, accepted_at = now() WHERE id = $1`,
      [id, driver.user.id],
    );
    expect(await expiry.expireStaleRequests()).toEqual([]);
  });

  it('is safe to run repeatedly', async () => {
    const passenger = await signUpPassenger(ctx);
    const id = await bookTrip(passenger.token, 200);
    expect(await expiry.expireStaleRequests()).toEqual([id]);
    expect(await expiry.expireStaleRequests()).toEqual([]);
  });
});

import {
  bearer,
  clearUploads,
  createTestApp,
  ISO_DATE,
  resetDatabase,
  signUpDriver,
  signUpPassenger,
  UUID,
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

const TOWN_CENTRE = { lat: 45.6169, lng: -61.9986, address: '1 West St, Antigonish, NS' };
const ST_FX = { lat: 45.6175, lng: -61.9933, address: 'St. Francis Xavier University' };
const HALIFAX = { lat: 44.6488, lng: -63.5752 };
const tripBody = { origin: TOWN_CENTRE, destination: ST_FX };

const createTrip = (token: string, body: object = tripBody) =>
  ctx.http().post('/api/trips').set(bearer(token)).send(body);

const FORBIDDEN = {
  success: false,
  message: 'Your account role is not allowed to perform this action',
  error: { statusCode: 403, status: 'Forbidden' },
};

/** Moves a trip along as the (not yet built) Driver endpoints would. */
const setTrip = (id: string, sql: string, params: unknown[] = []) =>
  ctx.db.query(`UPDATE trips SET ${sql} WHERE id = $1`, [id, ...params]);

// ------------------------------------------------------------------ createTrip
describe('POST /api/trips', () => {
  it('201: Passenger books a REQUESTED trip with the fixed fare', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token).expect(201);

    expect(res.body).toEqual({
      success: true,
      message: 'Trip requested successfully',
      data: {
        id: expect.stringMatching(UUID),
        status: 'REQUESTED',
        origin: TOWN_CENTRE,
        destination: ST_FX,
        fare: { amount: 8, currency: 'CAD' },
        passenger: {
          id: passenger.user.id,
          fullName: 'Jane Doe',
          phone: passenger.user.phone,
          photoUrl: null,
        },
        driver: null,
        cancelReason: null,
        cancelDetails: null,
        requestedAt: expect.stringMatching(ISO_DATE),
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
      },
    });
  });

  it('stores the fare on the trip', async () => {
    const passenger = await signUpPassenger(ctx);
    await createTrip(passenger.token).expect(201);
    const [row] = await ctx.db.query('SELECT fare_amount, fare_currency, status FROM trips');
    expect(row).toEqual({ fare_amount: '8.00', fare_currency: 'CAD', status: 'REQUESTED' });
  });

  it('address is optional, and a blank one is stored as null', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token, {
      origin: { lat: 45.6169, lng: -61.9986 },
      destination: { ...ST_FX, address: '   ' },
    }).expect(201);
    expect(res.body.data.origin.address).toBeNull();
    expect(res.body.data.destination.address).toBeNull();
  });

  it('ignores fields the client may not set (status, fare, passenger)', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token, {
      ...tripBody,
      status: 'COMPLETED',
      fare: { amount: 0, currency: 'USD' },
      passengerId: '00000000-0000-0000-0000-000000000000',
    }).expect(201);
    expect(res.body.data.status).toBe('REQUESTED');
    expect(res.body.data.fare).toEqual({ amount: 8, currency: 'CAD' });
    expect(res.body.data.passenger.id).toBe(passenger.user.id);
  });

  describe('one active trip per Passenger', () => {
    it('409: while the first trip is still REQUESTED', async () => {
      const passenger = await signUpPassenger(ctx);
      await createTrip(passenger.token).expect(201);
      const res = await createTrip(passenger.token).expect(409);
      expect(res.body).toEqual({
        success: false,
        message: 'You already have an active trip',
        error: { statusCode: 409, status: 'Conflict' },
      });
    });

    it.each(['ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS'])('409: while the first trip is %s', async (status) => {
      const passenger = await signUpPassenger(ctx);
      const driver = await signUpDriver(ctx);
      const first = await createTrip(passenger.token).expect(201);
      await setTrip(first.body.data.id, `status = $2, driver_id = $3, accepted_at = now()`, [status, driver.user.id]);
      await createTrip(passenger.token).expect(409);
    });

    it('201: once the first trip is COMPLETED', async () => {
      const passenger = await signUpPassenger(ctx);
      const driver = await signUpDriver(ctx);
      const first = await createTrip(passenger.token).expect(201);
      await setTrip(first.body.data.id, `status = 'COMPLETED', driver_id = $2, completed_at = now()`, [driver.user.id]);
      await createTrip(passenger.token).expect(201);
    });

    it('201: once the first trip is CANCELLED', async () => {
      const passenger = await signUpPassenger(ctx);
      const first = await createTrip(passenger.token).expect(201);
      await setTrip(first.body.data.id, `status = 'CANCELLED', cancel_reason = 'NO_DRIVER_FOUND', cancelled_at = now()`);
      await createTrip(passenger.token).expect(201);
    });

    it('does not block other Passengers', async () => {
      const first = await signUpPassenger(ctx);
      const second = await signUpPassenger(ctx);
      await createTrip(first.token).expect(201);
      await createTrip(second.token).expect(201);
    });

    it('concurrent bookings by the same Passenger create only one trip', async () => {
      const passenger = await signUpPassenger(ctx);
      const results = await Promise.all([1, 2, 3].map(() => createTrip(passenger.token)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const [{ count }] = await ctx.db.query('SELECT count(*)::int AS count FROM trips');
      expect(count).toBe(1);
    });
  });

  it.each([
    ['pickup', { origin: HALIFAX, destination: ST_FX }],
    ['destination', { origin: TOWN_CENTRE, destination: HALIFAX }],
  ])('422: %s outside the service area', async (_label, body) => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token, body).expect(422);
    expect(res.body).toEqual({
      success: false,
      message: 'Pickup or destination is outside the Antigonish service area',
      error: { statusCode: 422, status: 'Unprocessable Entity' },
    });
    const [{ count }] = await ctx.db.query('SELECT count(*)::int AS count FROM trips');
    expect(count).toBe(0);
  });

  it('400: lists every missing field', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token, {}).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'origin', message: 'Pickup location is required' },
      { field: 'destination', message: 'Destination is required' },
    ]);
  });

  it.each([
    [{ origin: { lng: -61.9986 }, destination: ST_FX }, 'origin.lat', 'Latitude is required'],
    [{ origin: { lat: '45.6', lng: -61.9986 }, destination: ST_FX }, 'origin.lat', 'Latitude must be a number'],
    [{ origin: { lat: 91, lng: -61.9986 }, destination: ST_FX }, 'origin.lat', 'Latitude must be between -90 and 90'],
    [{ origin: TOWN_CENTRE, destination: { lat: 45.6, lng: 181 } }, 'destination.lng', 'Longitude must be between -180 and 180'],
    [{ origin: TOWN_CENTRE, destination: { ...ST_FX, address: 'x'.repeat(256) } }, 'destination.address', 'Address must be at most 255 characters'],
    [{ origin: 'Antigonish', destination: ST_FX }, 'origin', 'Pickup location must be an object with lat and lng'],
  ])('400: %j', async (body, field, message) => {
    const passenger = await signUpPassenger(ctx);
    const res = await createTrip(passenger.token, body).expect(400);
    expect(res.body.error.details).toEqual([{ field, message }]);
  });

  it('403: a Driver cannot book a trip', async () => {
    const driver = await signUpDriver(ctx);
    const res = await createTrip(driver.token).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('401: no token', async () => {
    await ctx.http().post('/api/trips').send(tripBody).expect(401);
  });
});

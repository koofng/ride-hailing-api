import {
  bearer,
  clearUploads,
  createTestApp,
  resetDatabase,
  signUpDriver,
  signUpPassenger,
  type SignedUp,
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
/** About 5.6 km north of the town centre. */
const NORTH = { lat: 45.6669, lng: -61.9986 };
const DRIVER_AT_TOWN_CENTRE = '?lat=45.6169&lng=-61.9986';

const FORBIDDEN = {
  success: false,
  message: 'Your account role is not allowed to perform this action',
  error: { statusCode: 403, status: 'Forbidden' },
};

/** Books a trip for a new Passenger and returns both. */
const book = async (
  origin: object = TOWN_CENTRE,
  overrides: Record<string, unknown> = {},
): Promise<{ passenger: SignedUp; tripId: string }> => {
  const passenger = await signUpPassenger(ctx, overrides);
  const { body } = await ctx
    .http()
    .post('/api/trips')
    .set(bearer(passenger.token))
    .send({ origin, destination: ST_FX })
    .expect(201);
  return { passenger, tripId: body.data.id };
};

const setTrip = (id: string, sql: string, params: unknown[] = []) =>
  ctx.db.query(`UPDATE trips SET ${sql} WHERE id = $1`, [id, ...params]);

const backdate = (id: string, seconds: number) =>
  setTrip(id, 'requested_at = now() - make_interval(secs => $2)', [seconds]);

/** Puts a trip in `status` with `driverId` on it, as an accepted trip would be. */
const onTrip = (id: string, driverId: string, status = 'ACCEPTED') =>
  setTrip(id, `status = $2::text::trip_status, driver_id = $3, accepted_at = now()`, [status, driverId]);

// ------------------------------------------------------------------ listTripRequests
describe('GET /api/trips/requests', () => {
  const listRequests = (token: string, query = DRIVER_AT_TOWN_CENTRE) =>
    ctx.http().get(`/api/trips/requests${query}`).set(bearer(token));

  it('200: lists open requests with pickup, distance, first name and expiry', async () => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book(ST_FX, { fullName: 'Jane Q. Doe' });

    const res = await listRequests(driver.token).expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Trip requests retrieved successfully',
      data: [
        {
          tripId,
          pickup: ST_FX,
          distanceKm: 0.4,
          passengerName: 'Jane',
          expiresAt: expect.any(String),
        },
      ],
    });
  });

  it('expiresAt is TRIP_REQUEST_TTL_SECONDS after the trip was requested', async () => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book();
    const [{ requested_at }] = await ctx.db.query('SELECT requested_at FROM trips WHERE id = $1', [tripId]);
    const { body } = await listRequests(driver.token).expect(200);
    expect(new Date(body.data[0].expiresAt).getTime() - requested_at.getTime()).toBe(120_000);
  });

  it('never reveals the full name, phone, photo or destination before accepting', async () => {
    const driver = await signUpDriver(ctx);
    const { passenger } = await book();
    const text = JSON.stringify((await listRequests(driver.token).expect(200)).body);
    expect(text).not.toContain('Doe');
    expect(text).not.toContain(passenger.user.phone);
    expect(text).not.toContain('St. Francis Xavier');
    expect(text).not.toContain(passenger.user.id);
  });

  it('nearest pickup first', async () => {
    const driver = await signUpDriver(ctx);
    const far = await book(NORTH);
    const near = await book(TOWN_CENTRE);
    const middle = await book(ST_FX);

    const { body } = await listRequests(driver.token).expect(200);
    expect(body.data.map((r: { tripId: string }) => r.tripId)).toEqual([near.tripId, middle.tripId, far.tripId]);
    expect(body.data.map((r: { distanceKm: number }) => r.distanceKm)).toEqual([0, 0.4, 5.6]);
  });

  it('distance follows the position the Driver sends', async () => {
    const driver = await signUpDriver(ctx);
    await book(TOWN_CENTRE);
    const { body } = await listRequests(driver.token, `?lat=${NORTH.lat}&lng=${NORTH.lng}`).expect(200);
    expect(body.data[0].distanceKm).toBe(5.6);
  });

  it('leaves out expired requests even before the sweep has cancelled them', async () => {
    const driver = await signUpDriver(ctx);
    const old = await book();
    const fresh = await book(ST_FX);
    await backdate(old.tripId, 121);

    const { body } = await listRequests(driver.token).expect(200);
    expect(body.data.map((r: { tripId: string }) => r.tripId)).toEqual([fresh.tripId]);
  });

  it('leaves out trips that are accepted or cancelled', async () => {
    const driver = await signUpDriver(ctx);
    const other = await signUpDriver(ctx);
    const accepted = await book();
    const cancelled = await book();
    await onTrip(accepted.tripId, other.user.id);
    await ctx
      .http()
      .post(`/api/trips/${cancelled.tripId}/cancel`)
      .set(bearer(cancelled.passenger.token))
      .send({ reason: 'CHANGED_MIND' })
      .expect(200);

    expect((await listRequests(driver.token).expect(200)).body.data).toEqual([]);
  });

  it('a Driver on an active trip gets no requests', async () => {
    const driver = await signUpDriver(ctx);
    const current = await book();
    await book(ST_FX);
    await onTrip(current.tripId, driver.user.id, 'IN_PROGRESS');
    expect((await listRequests(driver.token).expect(200)).body.data).toEqual([]);
  });

  it('every Driver sees the same open requests', async () => {
    const first = await signUpDriver(ctx);
    const second = await signUpDriver(ctx);
    const { tripId } = await book();
    for (const driver of [first, second]) {
      expect((await listRequests(driver.token).expect(200)).body.data[0].tripId).toBe(tripId);
    }
  });

  it('200: empty list when there are no requests', async () => {
    const driver = await signUpDriver(ctx);
    expect((await listRequests(driver.token).expect(200)).body.data).toEqual([]);
  });

  it.each([
    ['', [
      { field: 'lat', message: 'Latitude is required' },
      { field: 'lng', message: 'Longitude is required' },
    ]],
    ['?lat=abc&lng=-61.9', [{ field: 'lat', message: 'Latitude must be a number' }]],
    ['?lat=45.6&lng=200', [{ field: 'lng', message: 'Longitude must be between -180 and 180' }]],
  ])('400: position %j', async (query, details) => {
    const driver = await signUpDriver(ctx);
    const res = await listRequests(driver.token, query).expect(400);
    expect(res.body.error.details).toEqual(details);
  });

  it('403: a Passenger cannot list trip requests', async () => {
    const { passenger } = await book();
    const res = await listRequests(passenger.token).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('401: no token', async () => {
    await ctx.http().get(`/api/trips/requests${DRIVER_AT_TOWN_CENTRE}`).expect(401);
  });
});

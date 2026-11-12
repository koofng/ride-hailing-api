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

// ------------------------------------------------------------------ acceptTrip
describe('POST /api/trips/:tripId/accept', () => {
  const accept = (token: string, id: string) =>
    ctx.http().post(`/api/trips/${id}/accept`).set(bearer(token));

  const conflict = (message: string) => ({
    success: false,
    message,
    error: { statusCode: 409, status: 'Conflict' },
  });

  it('200: the Driver takes the trip and sees the full Passenger details', async () => {
    const driver = await signUpDriver(ctx);
    const { passenger, tripId } = await book();

    const res = await accept(driver.token, tripId).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Trip accepted successfully',
      data: {
        id: tripId,
        status: 'ACCEPTED',
        acceptedAt: expect.any(String),
        passenger: { id: passenger.user.id, fullName: 'Jane Doe', phone: passenger.user.phone },
        driver: { id: driver.user.id },
        destination: ST_FX,
      },
    });
  });

  it('the Passenger now sees the Driver and vehicle on their active trip', async () => {
    const driver = await signUpDriver(ctx);
    const { passenger, tripId } = await book();
    await accept(driver.token, tripId).expect(200);

    const { body } = await ctx.http().get('/api/trips/active').set(bearer(passenger.token)).expect(200);
    expect(body.data).toMatchObject({ id: tripId, status: 'ACCEPTED' });
    expect(body.data.driver).toMatchObject({
      id: driver.user.id,
      fullName: 'John Smith',
      vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver' },
    });
  });

  it('the trip becomes the Driver’s active trip and leaves everyone’s request list', async () => {
    const driver = await signUpDriver(ctx);
    const other = await signUpDriver(ctx);
    const { tripId } = await book();
    await accept(driver.token, tripId).expect(200);

    const active = await ctx.http().get('/api/trips/active').set(bearer(driver.token)).expect(200);
    expect(active.body.data.id).toBe(tripId);
    const list = await ctx
      .http()
      .get(`/api/trips/requests${DRIVER_AT_TOWN_CENTRE}`)
      .set(bearer(other.token))
      .expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('the Passenger can no longer cancel once accepted', async () => {
    const driver = await signUpDriver(ctx);
    const { passenger, tripId } = await book();
    await accept(driver.token, tripId).expect(200);
    await ctx
      .http()
      .post(`/api/trips/${tripId}/cancel`)
      .set(bearer(passenger.token))
      .send({ reason: 'CHANGED_MIND' })
      .expect(409);
  });

  describe('409: no longer available', () => {
    it('another Driver accepted it first', async () => {
      const first = await signUpDriver(ctx);
      const second = await signUpDriver(ctx);
      const { tripId } = await book();
      await accept(first.token, tripId).expect(200);

      const res = await accept(second.token, tripId).expect(409);
      expect(res.body).toEqual(conflict('This trip is no longer available'));
    });

    it('the Passenger cancelled', async () => {
      const driver = await signUpDriver(ctx);
      const { passenger, tripId } = await book();
      await ctx
        .http()
        .post(`/api/trips/${tripId}/cancel`)
        .set(bearer(passenger.token))
        .send({ reason: 'CHANGED_MIND' })
        .expect(200);
      expect((await accept(driver.token, tripId).expect(409)).body.message).toBe('This trip is no longer available');
    });

    it('the request expired, even before the sweep cancelled it', async () => {
      const driver = await signUpDriver(ctx);
      const { tripId } = await book();
      await backdate(tripId, 121);
      await accept(driver.token, tripId).expect(409);
      const [row] = await ctx.db.query('SELECT status, driver_id FROM trips');
      expect(row).toEqual({ status: 'REQUESTED', driver_id: null });
    });
  });

  it('409: the Driver already has an active trip', async () => {
    const driver = await signUpDriver(ctx);
    const current = await book();
    const next = await book(ST_FX);
    await accept(driver.token, current.tripId).expect(200);

    const res = await accept(driver.token, next.tripId).expect(409);
    expect(res.body).toEqual(conflict('Complete your current trip before accepting a new one'));
    const [row] = await ctx.db.query('SELECT status FROM trips WHERE id = $1', [next.tripId]);
    expect(row.status).toBe('REQUESTED');
  });

  it('a Driver can accept again once their trip is completed', async () => {
    const driver = await signUpDriver(ctx);
    const current = await book();
    const next = await book(ST_FX);
    await accept(driver.token, current.tripId).expect(200);
    await setTrip(current.tripId, `status = 'COMPLETED', completed_at = now()`);
    await accept(driver.token, next.tripId).expect(200);
  });

  it('several Drivers accepting at once: exactly one wins', async () => {
    const drivers = await Promise.all([1, 2, 3, 4].map(() => signUpDriver(ctx)));
    const { tripId } = await book();

    const results = await Promise.all(drivers.map((d) => accept(d.token, tripId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    const winner = drivers[results.findIndex((r) => r.status === 200)];
    const [row] = await ctx.db.query('SELECT driver_id FROM trips WHERE id = $1', [tripId]);
    expect(row.driver_id).toBe(winner.user.id);
  });

  it('one Driver accepting two trips at once ends up with only one', async () => {
    const driver = await signUpDriver(ctx);
    const a = await book();
    const b = await book(ST_FX);

    const results = await Promise.all([accept(driver.token, a.tripId), accept(driver.token, b.tripId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [{ count }] = await ctx.db.query(
      `SELECT count(*)::int AS count FROM trips WHERE driver_id = $1`,
      [driver.user.id],
    );
    expect(count).toBe(1);
  });

  it.each(['3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11', 'not-a-uuid'])('404: unknown or malformed id %s', async (id) => {
    const driver = await signUpDriver(ctx);
    const res = await accept(driver.token, id).expect(404);
    expect(res.body.message).toBe('Trip not found');
  });

  it('403: a Passenger cannot accept a trip', async () => {
    const { passenger, tripId } = await book();
    const res = await accept(passenger.token, tripId).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('401: no token', async () => {
    const { tripId } = await book();
    await ctx.http().post(`/api/trips/${tripId}/accept`).expect(401);
  });
});

// ------------------------------------------------------------------ declineTrip
describe('POST /api/trips/:tripId/decline', () => {
  const decline = (token: string, id: string) =>
    ctx.http().post(`/api/trips/${id}/decline`).set(bearer(token));
  const listRequests = (token: string) =>
    ctx.http().get(`/api/trips/requests${DRIVER_AT_TOWN_CENTRE}`).set(bearer(token));

  it('200: removes the request from this Driver’s list, data null', async () => {
    const driver = await signUpDriver(ctx);
    const declined = await book();
    const kept = await book(ST_FX);

    const res = await decline(driver.token, declined.tripId).expect(200);
    expect(res.body).toEqual({ success: true, message: 'Trip request declined', data: null });

    const { body } = await listRequests(driver.token).expect(200);
    expect(body.data.map((r: { tripId: string }) => r.tripId)).toEqual([kept.tripId]);
  });

  it('the trip stays open for every other Driver, and REQUESTED for the Passenger', async () => {
    const decliner = await signUpDriver(ctx);
    const other = await signUpDriver(ctx);
    const { passenger, tripId } = await book();
    await decline(decliner.token, tripId).expect(200);

    expect((await listRequests(other.token).expect(200)).body.data[0].tripId).toBe(tripId);
    await ctx.http().post(`/api/trips/${tripId}/accept`).set(bearer(other.token)).expect(200);
    const { body } = await ctx.http().get(`/api/trips/${tripId}`).set(bearer(passenger.token)).expect(200);
    expect(body.data.driver.id).toBe(other.user.id);
  });

  it('a Driver cannot accept a request they declined', async () => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book();
    await decline(driver.token, tripId).expect(200);
    const res = await ctx.http().post(`/api/trips/${tripId}/accept`).set(bearer(driver.token)).expect(409);
    expect(res.body.message).toBe('This trip is no longer available');
  });

  it('declining twice is harmless', async () => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book();
    await decline(driver.token, tripId).expect(200);
    await decline(driver.token, tripId).expect(200);
    const [{ count }] = await ctx.db.query('SELECT count(*)::int AS count FROM trip_declines');
    expect(count).toBe(1);
  });

  it.each([
    ['accepted by another Driver', async (tripId: string) => onTrip(tripId, (await signUpDriver(ctx)).user.id)],
    ['expired', (tripId: string) => backdate(tripId, 121)],
    ['cancelled', (tripId: string) =>
      setTrip(tripId, `status = 'CANCELLED', cancel_reason = 'PASSENGER_CANCELLED', cancelled_at = now()`)],
  ])('409: the request was %s', async (_label, change) => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book();
    await change(tripId);
    const res = await decline(driver.token, tripId).expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'This trip is no longer available',
      error: { statusCode: 409, status: 'Conflict' },
    });
  });

  it.each(['3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11', 'not-a-uuid'])('404: unknown or malformed id %s', async (id) => {
    const driver = await signUpDriver(ctx);
    expect((await decline(driver.token, id).expect(404)).body.message).toBe('Trip not found');
  });

  it('403: a Passenger cannot decline', async () => {
    const { passenger, tripId } = await book();
    expect((await decline(passenger.token, tripId).expect(403)).body).toEqual(FORBIDDEN);
  });

  it('401: no token', async () => {
    const { tripId } = await book();
    await ctx.http().post(`/api/trips/${tripId}/decline`).expect(401);
  });
});

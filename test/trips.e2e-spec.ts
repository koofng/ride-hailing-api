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

/** Assigns a Driver and moves the trip to `status`, filling in the timestamps on the way. */
const assignDriver = (id: string, driverId: string, status: string) =>
  setTrip(
    id,
    `driver_id = $2, status = $3::text::trip_status, accepted_at = now(),
     arrived_at = CASE WHEN $3::text IN ('DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED') THEN now() END,
     started_at = CASE WHEN $3::text IN ('IN_PROGRESS', 'COMPLETED') THEN now() END,
     completed_at = CASE WHEN $3::text = 'COMPLETED' THEN now() END`,
    [driverId, status],
  );

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

// ------------------------------------------------------------------ getTrip
describe('GET /api/trips/:tripId', () => {
  const getTrip = (token: string, id: string) => ctx.http().get(`/api/trips/${id}`).set(bearer(token));

  const NOT_FOUND = {
    success: false,
    message: 'Trip not found',
    error: { statusCode: 404, status: 'Not Found' },
  };

  /** A Passenger with a booked trip, and a Driver (not yet assigned). */
  const setUp = async () => {
    const passenger = await signUpPassenger(ctx);
    const driver = await signUpDriver(ctx);
    const created = await createTrip(passenger.token).expect(201);
    return { passenger, driver, tripId: created.body.data.id as string, created: created.body.data };
  };

  describe('as the Passenger', () => {
    it('200: returns the same trip that was created', async () => {
      const { passenger, tripId, created } = await setUp();
      const res = await getTrip(passenger.token, tripId).expect(200);
      expect(res.body).toEqual({ success: true, message: 'Trip retrieved successfully', data: created });
    });

    it('sees the Driver, their vehicle and the fare once a Driver accepts', async () => {
      const { passenger, driver, tripId } = await setUp();
      await assignDriver(tripId, driver.user.id, 'ACCEPTED');
      const { body } = await getTrip(passenger.token, tripId).expect(200);

      expect(body.data.status).toBe('ACCEPTED');
      expect(body.data.fare).toEqual({ amount: 8, currency: 'CAD' });
      expect(body.data.acceptedAt).toMatch(ISO_DATE);
      expect(body.data.driver).toEqual({
        id: driver.user.id,
        fullName: 'John Smith',
        phone: driver.user.phone,
        photoUrl: expect.stringMatching(/\/api\/files\/photos\//),
        vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plateNumber: driver.user.driverDetails!.vehicle.plateNumber },
      });
    });

    it('does not see the Driver on a cancelled trip', async () => {
      const { passenger, driver, tripId } = await setUp();
      await setTrip(
        tripId,
        `driver_id = $2, status = 'CANCELLED', cancel_reason = 'PASSENGER_CANCELLED', cancelled_at = now()`,
        [driver.user.id],
      );
      const { body } = await getTrip(passenger.token, tripId).expect(200);
      expect(body.data.status).toBe('CANCELLED');
      expect(body.data.driver).toBeNull();
      expect(body.data.passenger.id).toBe(passenger.user.id);
    });

    it("404: another Passenger's trip", async () => {
      const { tripId } = await setUp();
      const stranger = await signUpPassenger(ctx);
      const res = await getTrip(stranger.token, tripId).expect(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('as the Driver', () => {
    it.each(['ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED'])(
      '200: sees the Passenger while %s',
      async (status) => {
        const { passenger, driver, tripId } = await setUp();
        await assignDriver(tripId, driver.user.id, status);
        const { body } = await getTrip(driver.token, tripId).expect(200);

        expect(body.data.status).toBe(status);
        expect(body.data.passenger).toEqual({
          id: passenger.user.id,
          fullName: 'Jane Doe',
          phone: passenger.user.phone,
          photoUrl: null,
        });
        expect(body.data.driver.id).toBe(driver.user.id);
      },
    );

    it('fills in each timestamp as the trip progresses', async () => {
      const { driver, tripId } = await setUp();
      await assignDriver(tripId, driver.user.id, 'COMPLETED');
      const { body } = await getTrip(driver.token, tripId).expect(200);
      for (const field of ['requestedAt', 'acceptedAt', 'arrivedAt', 'startedAt', 'completedAt']) {
        expect(body.data[field]).toMatch(ISO_DATE);
      }
      expect(body.data.cancelledAt).toBeNull();
    });

    it('does not see the Passenger on a cancelled trip', async () => {
      const { driver, tripId } = await setUp();
      await setTrip(
        tripId,
        `driver_id = $2, status = 'CANCELLED', cancel_reason = 'PASSENGER_CANCELLED',
         passenger_cancel_reason = 'CHANGED_MIND', cancel_note = 'private', cancelled_at = now()`,
        [driver.user.id],
      );
      const { body } = await getTrip(driver.token, tripId).expect(200);
      expect(body.data.passenger).toBeNull();
      expect(body.data.cancelDetails).toBeNull();
      expect(JSON.stringify(body)).not.toContain('private');
    });

    it('404: a trip they have not accepted (even an open request)', async () => {
      const { driver, tripId } = await setUp();
      const res = await getTrip(driver.token, tripId).expect(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it("404: another Driver's trip", async () => {
      const { driver, tripId } = await setUp();
      await assignDriver(tripId, driver.user.id, 'ACCEPTED');
      const other = await signUpDriver(ctx);
      await getTrip(other.token, tripId).expect(404);
    });
  });

  it.each([
    ['an unknown id', '3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11'],
    ['a malformed id', 'not-a-uuid'],
  ])('404: %s', async (_label, id) => {
    const passenger = await signUpPassenger(ctx);
    const res = await getTrip(passenger.token, id).expect(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('401: no token', async () => {
    const { tripId } = await setUp();
    await ctx.http().get(`/api/trips/${tripId}`).expect(401);
  });
});

// ------------------------------------------------------------------ listTrips
describe('GET /api/trips', () => {
  const listTrips = (token: string, query = '') =>
    ctx.http().get(`/api/trips${query}`).set(bearer(token));

  /** Inserts a past trip directly, consistent with the table's check constraints. */
  const insertTrip = async (
    passengerId: string,
    status: string,
    requestedAt: string,
    driverId: string | null = null,
  ): Promise<string> => {
    const cancelled = status === 'CANCELLED';
    const [row] = await ctx.db.query(
      `INSERT INTO trips (passenger_id, driver_id, status, origin_lat, origin_lng, destination_lat,
         destination_lng, fare_amount, fare_currency, requested_at, cancel_reason, cancelled_at, completed_at)
       VALUES ($1, $2, $3::text::trip_status, 45.6169, -61.9986, 45.6175, -61.9933, 8, 'CAD', $4,
         $5::text::trip_cancel_reason, $6::timestamptz, $7::timestamptz)
       RETURNING id`,
      [
        passengerId,
        driverId,
        status,
        requestedAt,
        cancelled ? 'NO_DRIVER_FOUND' : null,
        cancelled ? requestedAt : null,
        status === 'COMPLETED' ? requestedAt : null,
      ],
    );
    return row.id;
  };

  /** A Passenger with 3 past trips (2 completed with the Driver, 1 cancelled) and an active one. */
  const setUp = async () => {
    const passenger = await signUpPassenger(ctx);
    const driver = await signUpDriver(ctx);
    const ids = {
      oldest: await insertTrip(passenger.user.id, 'COMPLETED', '2026-11-01T10:00:00Z', driver.user.id),
      cancelled: await insertTrip(passenger.user.id, 'CANCELLED', '2026-11-02T10:00:00Z'),
      completed: await insertTrip(passenger.user.id, 'COMPLETED', '2026-11-03T10:00:00Z', driver.user.id),
      active: await insertTrip(passenger.user.id, 'REQUESTED', '2026-11-04T10:00:00Z'),
    };
    return { passenger, driver, ids };
  };

  it('200: Passenger sees all their trips, newest first, with the default page', async () => {
    const { passenger, ids } = await setUp();
    const res = await listTrips(passenger.token).expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: 'Trips retrieved successfully',
      data: { page: 0, size: 20, totalItems: 4 },
    });
    expect(res.body.data.items.map((t: { id: string }) => t.id)).toEqual([
      ids.active,
      ids.completed,
      ids.cancelled,
      ids.oldest,
    ]);
  });

  it('items use the same Trip shape and visibility rules as getTrip', async () => {
    const { passenger, ids } = await setUp();
    const list = await listTrips(passenger.token).expect(200);
    for (const id of [ids.completed, ids.cancelled]) {
      const one = await ctx.http().get(`/api/trips/${id}`).set(bearer(passenger.token)).expect(200);
      expect(list.body.data.items.find((t: { id: string }) => t.id === id)).toEqual(one.body.data);
    }
  });

  it('200: Driver sees only the trips they accepted, with the Passenger on completed ones', async () => {
    const { passenger, driver, ids } = await setUp();
    const res = await listTrips(driver.token).expect(200);

    expect(res.body.data.totalItems).toBe(2);
    expect(res.body.data.items.map((t: { id: string }) => t.id)).toEqual([ids.completed, ids.oldest]);
    for (const trip of res.body.data.items) {
      expect(trip.passenger.id).toBe(passenger.user.id);
    }
  });

  it('only ever returns the caller’s own trips', async () => {
    await setUp();
    const otherPassenger = await signUpPassenger(ctx);
    const otherDriver = await signUpDriver(ctx);
    for (const user of [otherPassenger, otherDriver]) {
      const res = await listTrips(user.token).expect(200);
      expect(res.body.data).toEqual({ items: [], page: 0, size: 20, totalItems: 0 });
    }
  });

  it.each([
    ['?status=COMPLETED', ['completed', 'oldest']],
    ['?status=COMPLETED,CANCELLED', ['completed', 'cancelled', 'oldest']],
    ['?status=COMPLETED&status=CANCELLED', ['completed', 'cancelled', 'oldest']],
    ['?status=requested', ['active']],
    ['?status=IN_PROGRESS', []],
  ])('filters by status: %s', async (query, expected) => {
    const { passenger, ids } = await setUp();
    const res = await listTrips(passenger.token, query).expect(200);
    expect(res.body.data.items.map((t: { id: string }) => t.id)).toEqual(
      expected.map((k) => ids[k as keyof typeof ids]),
    );
    expect(res.body.data.totalItems).toBe(expected.length);
  });

  it('paginates, and totalItems counts every matching trip', async () => {
    const { passenger, ids } = await setUp();
    const first = await listTrips(passenger.token, '?page=0&size=3').expect(200);
    const second = await listTrips(passenger.token, '?page=1&size=3').expect(200);
    const beyond = await listTrips(passenger.token, '?page=5&size=3').expect(200);

    expect(first.body.data).toMatchObject({ page: 0, size: 3, totalItems: 4 });
    expect(first.body.data.items).toHaveLength(3);
    expect(second.body.data.items.map((t: { id: string }) => t.id)).toEqual([ids.oldest]);
    expect(beyond.body.data).toMatchObject({ items: [], page: 5, size: 3, totalItems: 4 });
  });

  it.each([
    ['?status=FINISHED', 'status', 'Status must be one of: REQUESTED, ACCEPTED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED'],
    ['?page=-1', 'page', 'Page must be 0 or more'],
    ['?page=abc', 'page', 'Page must be a whole number'],
    ['?size=0', 'size', 'Size must be between 1 and 100'],
    ['?size=101', 'size', 'Size must be between 1 and 100'],
    ['?size=2.5', 'size', 'Size must be a whole number'],
  ])('400: %s', async (query, field, message) => {
    const passenger = await signUpPassenger(ctx);
    const res = await listTrips(passenger.token, query).expect(400);
    expect(res.body.error.details).toEqual([{ field, message }]);
  });

  it('401: no token', async () => {
    await ctx.http().get('/api/trips').expect(401);
  });
});

// ------------------------------------------------------------------ getActiveTrip
describe('GET /api/trips/active', () => {
  const getActive = (token: string) => ctx.http().get('/api/trips/active').set(bearer(token));

  const NONE = { success: true, message: 'You have no active trip', data: null };

  it('200: Passenger with no trips gets data null', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await getActive(passenger.token).expect(200);
    expect(res.body).toEqual(NONE);
  });

  it('200: Passenger gets their REQUESTED trip, same as getTrip', async () => {
    const passenger = await signUpPassenger(ctx);
    const created = await createTrip(passenger.token).expect(201);
    const res = await getActive(passenger.token).expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Active trip retrieved successfully',
      data: created.body.data,
    });
  });

  it.each(['ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS'])(
    '200: both Passenger and Driver see the trip while %s',
    async (status) => {
      const passenger = await signUpPassenger(ctx);
      const driver = await signUpDriver(ctx);
      const { body } = await createTrip(passenger.token).expect(201);
      await assignDriver(body.data.id, driver.user.id, status);

      const forPassenger = await getActive(passenger.token).expect(200);
      const forDriver = await getActive(driver.token).expect(200);

      expect(forPassenger.body.data).toMatchObject({ id: body.data.id, status });
      expect(forPassenger.body.data.driver.id).toBe(driver.user.id);
      expect(forDriver.body.data).toMatchObject({ id: body.data.id, status });
      expect(forDriver.body.data.passenger.id).toBe(passenger.user.id);
    },
  );

  it('a Driver has no active trip while a request is still unaccepted', async () => {
    const passenger = await signUpPassenger(ctx);
    const driver = await signUpDriver(ctx);
    await createTrip(passenger.token).expect(201);
    expect((await getActive(driver.token).expect(200)).body).toEqual(NONE);
  });

  it.each([
    ['COMPLETED', `status = 'COMPLETED', driver_id = $2, completed_at = now()`],
    ['CANCELLED', `status = 'CANCELLED', cancel_reason = 'NO_DRIVER_FOUND', cancelled_at = now()`],
  ])('data null for both once the trip is %s', async (_status, sql) => {
    const passenger = await signUpPassenger(ctx);
    const driver = await signUpDriver(ctx);
    const { body } = await createTrip(passenger.token).expect(201);
    await setTrip(body.data.id, sql, sql.includes('$2') ? [driver.user.id] : []);

    expect((await getActive(passenger.token).expect(200)).body).toEqual(NONE);
    expect((await getActive(driver.token).expect(200)).body).toEqual(NONE);
  });

  it("never returns someone else's active trip", async () => {
    const passenger = await signUpPassenger(ctx);
    await createTrip(passenger.token).expect(201);
    const other = await signUpPassenger(ctx);
    expect((await getActive(other.token).expect(200)).body).toEqual(NONE);
  });

  it('401: no token', async () => {
    await ctx.http().get('/api/trips/active').expect(401);
  });
});

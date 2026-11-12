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

const TOWN_CENTRE = { lat: 45.6169, lng: -61.9986 };
const ST_FX = { lat: 45.6175, lng: -61.9933 };

const FORBIDDEN = {
  success: false,
  message: 'Your account role is not allowed to perform this action',
  error: { statusCode: 403, status: 'Forbidden' },
};

const setAvailability = (token: string, body: object) =>
  ctx.http().patch('/api/drivers/me/availability').set(bearer(token)).send(body);

const driverRow = async (userId: string) => {
  const [row] = await ctx.db.query(
    'SELECT available, last_lat, last_lng, location_updated_at FROM driver_details WHERE user_id = $1',
    [userId],
  );
  return row;
};

/** Books a trip and puts `driverId` on it in `status`. */
const tripWithDriver = async (driverId: string, status: string) => {
  const passenger = await signUpPassenger(ctx);
  const { body } = await ctx
    .http()
    .post('/api/trips')
    .set(bearer(passenger.token))
    .send({ origin: TOWN_CENTRE, destination: ST_FX })
    .expect(201);
  await ctx.db.query(
    `UPDATE trips SET status = $2::text::trip_status, driver_id = $3, accepted_at = now() WHERE id = $1`,
    [body.data.id, status, driverId],
  );
  return { passenger, tripId: body.data.id as string };
};

// ------------------------------------------------------------------ setMyAvailability
describe('PATCH /api/drivers/me/availability', () => {
  it('200: goes online and records the position', async () => {
    const driver = await signUpDriver(ctx);
    const res = await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);

    expect(res.body).toEqual({ success: true, message: 'You are now online', data: { available: true } });
    expect(await driverRow(driver.user.id)).toMatchObject({
      available: true,
      last_lat: TOWN_CENTRE.lat,
      last_lng: TOWN_CENTRE.lng,
      location_updated_at: expect.any(Date),
    });
  });

  it('the profile reflects the new availability', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
    const { body } = await ctx.http().get('/api/users/me').set(bearer(driver.token)).expect(200);
    expect(body.data.driverDetails.available).toBe(true);
  });

  it('200: goes offline and forgets the position', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
    const res = await setAvailability(driver.token, { available: false }).expect(200);

    expect(res.body).toEqual({ success: true, message: 'You are now offline', data: { available: false } });
    expect(await driverRow(driver.user.id)).toEqual({
      available: false,
      last_lat: null,
      last_lng: null,
      location_updated_at: null,
    });
  });

  it('going online again updates the position', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
    await setAvailability(driver.token, { available: true, ...ST_FX }).expect(200);
    expect(await driverRow(driver.user.id)).toMatchObject({ last_lat: ST_FX.lat, last_lng: ST_FX.lng });
  });

  it('going offline needs no position, and one sent is ignored', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: false, ...TOWN_CENTRE }).expect(200);
    expect((await driverRow(driver.user.id)).last_lat).toBeNull();
  });

  it('logging out also goes offline and forgets the position', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
    await ctx.http().post('/api/auth/logout').set(bearer(driver.token)).expect(200);
    expect(await driverRow(driver.user.id)).toMatchObject({ available: false, last_lat: null });
  });

  it.each(['ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS'])(
    '409: cannot go offline while a trip is %s',
    async (status) => {
      const driver = await signUpDriver(ctx);
      await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
      await tripWithDriver(driver.user.id, status);

      const res = await setAvailability(driver.token, { available: false }).expect(409);
      expect(res.body).toEqual({
        success: false,
        message: 'You cannot go offline while you have an active trip',
        error: { statusCode: 409, status: 'Conflict' },
      });
      expect((await driverRow(driver.user.id)).available).toBe(true);
    },
  );

  it('can go offline once the trip is completed', async () => {
    const driver = await signUpDriver(ctx);
    await setAvailability(driver.token, { available: true, ...TOWN_CENTRE }).expect(200);
    await tripWithDriver(driver.user.id, 'COMPLETED');
    await setAvailability(driver.token, { available: false }).expect(200);
  });

  it.each([
    [{}, [{ field: 'available', message: 'Available is required' }]],
    [{ available: 'yes' }, [{ field: 'available', message: 'Available must be true or false' }]],
    [{ available: true }, [
      { field: 'lat', message: 'Latitude is required to go online' },
      { field: 'lng', message: 'Longitude is required to go online' },
    ]],
    [{ available: true, lat: 95, lng: -61.9 }, [{ field: 'lat', message: 'Latitude must be between -90 and 90' }]],
    [{ available: true, lat: 45.6, lng: '-61.9' }, [{ field: 'lng', message: 'Longitude must be a number' }]],
  ])('400: %j', async (body, details) => {
    const driver = await signUpDriver(ctx);
    const res = await setAvailability(driver.token, body).expect(400);
    expect(res.body.error.details).toEqual(details);
    expect((await driverRow(driver.user.id)).available).toBe(false);
  });

  it('403: a Passenger has no availability', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await setAvailability(passenger.token, { available: true, ...TOWN_CENTRE }).expect(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('401: no token', async () => {
    await ctx.http().patch('/api/drivers/me/availability').send({ available: false }).expect(401);
  });
});

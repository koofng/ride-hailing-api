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

const TOWN_CENTRE = { lat: 45.6169, lng: -61.9986, address: '1 West St, Antigonish, NS' };
const ST_FX = { lat: 45.6175, lng: -61.9933 };
const HALIFAX = { lat: 44.6488, lng: -63.5752 };

const quote = (token: string, body: object) =>
  ctx.http().post('/api/fares/quote').set(bearer(token)).send(body);

// ------------------------------------------------------------------ quoteFare
describe('POST /api/fares/quote', () => {
  it('200: the fixed fare for a trip inside the service area', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await quote(passenger.token, { origin: TOWN_CENTRE, destination: ST_FX }).expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Fare quote retrieved successfully',
      data: { fare: { amount: 8, currency: 'CAD' }, withinServiceArea: true },
    });
  });

  it.each([
    ['pickup', { origin: HALIFAX, destination: ST_FX }],
    ['destination', { origin: TOWN_CENTRE, destination: HALIFAX }],
  ])('200 with withinServiceArea false when the %s is outside', async (_label, body) => {
    const passenger = await signUpPassenger(ctx);
    const res = await quote(passenger.token, body).expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Pickup or destination is outside the Antigonish service area',
      data: { fare: { amount: 8, currency: 'CAD' }, withinServiceArea: false },
    });
  });

  it('matches what booking the same trip charges, and what booking allows', async () => {
    const passenger = await signUpPassenger(ctx);
    const inside = { origin: TOWN_CENTRE, destination: ST_FX };
    const q = await quote(passenger.token, inside).expect(200);
    const trip = await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(inside).expect(201);
    expect(trip.body.data.fare).toEqual(q.body.data.fare);

    const outside = { origin: TOWN_CENTRE, destination: HALIFAX };
    expect((await quote(passenger.token, outside).expect(200)).body.data.withinServiceArea).toBe(false);
    await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(outside).expect(422);
  });

  it('creates nothing', async () => {
    const passenger = await signUpPassenger(ctx);
    await quote(passenger.token, { origin: TOWN_CENTRE, destination: ST_FX }).expect(200);
    const [{ count }] = await ctx.db.query('SELECT count(*)::int AS count FROM trips');
    expect(count).toBe(0);
  });

  it('works while the Passenger has an active trip (it is only a quote)', async () => {
    const passenger = await signUpPassenger(ctx);
    const body = { origin: TOWN_CENTRE, destination: ST_FX };
    await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(body).expect(201);
    await quote(passenger.token, body).expect(200);
  });

  it('ignores a fare sent by the client', async () => {
    const passenger = await signUpPassenger(ctx);
    const res = await quote(passenger.token, {
      origin: TOWN_CENTRE,
      destination: ST_FX,
      fare: { amount: 1, currency: 'USD' },
    }).expect(200);
    expect(res.body.data.fare).toEqual({ amount: 8, currency: 'CAD' });
  });

  it.each([
    [{}, [
      { field: 'origin', message: 'Pickup location is required' },
      { field: 'destination', message: 'Destination is required' },
    ]],
    [{ origin: { lat: 91, lng: -61.9 }, destination: ST_FX }, [
      { field: 'origin.lat', message: 'Latitude must be between -90 and 90' },
    ]],
    [{ origin: TOWN_CENTRE, destination: { lat: 45.6 } }, [
      { field: 'destination.lng', message: 'Longitude is required' },
    ]],
  ])('400: %j', async (body, details) => {
    const passenger = await signUpPassenger(ctx);
    expect((await quote(passenger.token, body).expect(400)).body.error.details).toEqual(details);
  });

  it('403: a Driver cannot request a quote', async () => {
    const driver = await signUpDriver(ctx);
    const res = await quote(driver.token, { origin: TOWN_CENTRE, destination: ST_FX }).expect(403);
    expect(res.body.message).toBe('Your account role is not allowed to perform this action');
  });

  it('401: no token', async () => {
    await ctx.http().post('/api/fares/quote').send({ origin: TOWN_CENTRE, destination: ST_FX }).expect(401);
  });
});

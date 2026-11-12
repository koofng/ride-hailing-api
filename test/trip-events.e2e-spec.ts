import { TripEvents, type TripEvent } from '../src/trips/trip-events.js';
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
let published: TripEvent[];
let unsubscribe: () => void;

beforeAll(async () => {
  ctx = await createTestApp();
  unsubscribe = ctx.app.get(TripEvents).subscribe((e) => {
    published.push(e);
  });
});

afterAll(async () => {
  unsubscribe();
  await ctx?.app.close();
});

beforeEach(async () => {
  published = [];
  await resetDatabase(ctx.db);
  await clearUploads();
});

const body = { origin: { lat: 45.6169, lng: -61.9986 }, destination: { lat: 45.6175, lng: -61.9933 } };

const book = async () => {
  const passenger = await signUpPassenger(ctx);
  const { body: res } = await ctx.http().post('/api/trips').set(bearer(passenger.token)).send(body).expect(201);
  return { passenger, tripId: res.data.id as string };
};

describe('trip events published by the trip services', () => {
  it('a whole trip: requested, accepted, arrived, started, completed', async () => {
    const driver = await signUpDriver(ctx);
    const { passenger, tripId } = await book();
    for (const step of ['accept', 'arrive', 'start', 'complete']) {
      await ctx.http().post(`/api/trips/${tripId}/${step}`).set(bearer(driver.token)).expect(200);
    }
    const ids = { tripId, passengerId: passenger.user.id };
    expect(published).toEqual([
      { type: 'requested', ...ids },
      { type: 'accepted', ...ids, driverId: driver.user.id },
      { type: 'progressed', ...ids, driverId: driver.user.id, status: 'DRIVER_ARRIVED' },
      { type: 'progressed', ...ids, driverId: driver.user.id, status: 'IN_PROGRESS' },
      { type: 'progressed', ...ids, driverId: driver.user.id, status: 'COMPLETED' },
    ]);
  });

  it('cancelled by the Passenger', async () => {
    const { passenger, tripId } = await book();
    await ctx
      .http()
      .post(`/api/trips/${tripId}/cancel`)
      .set(bearer(passenger.token))
      .send({ reason: 'CHANGED_MIND' })
      .expect(200);
    expect(published.at(-1)).toEqual({ type: 'cancelled', tripId, passengerId: passenger.user.id });
  });

  it('expired by the sweep', async () => {
    const { passenger, tripId } = await book();
    await ctx.db.query(`UPDATE trips SET requested_at = now() - interval '1 hour'`);
    await ctx.app.get(TripExpiryService).expireStaleRequests();
    expect(published.at(-1)).toEqual({ type: 'expired', tripId, passengerId: passenger.user.id });
  });

  it('nothing is published when an action fails', async () => {
    const driver = await signUpDriver(ctx);
    const { tripId } = await book();
    published = [];
    await ctx.http().post(`/api/trips/${tripId}/arrive`).set(bearer(driver.token)).expect(404);
    await ctx.http().post(`/api/trips/${tripId}/decline`).set(bearer(driver.token)).expect(200);
    expect(published).toEqual([]);
  });
});

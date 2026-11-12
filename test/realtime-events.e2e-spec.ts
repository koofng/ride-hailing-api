import type { Socket } from 'socket.io-client';
import { TripExpiryService } from '../src/trips/trip-expiry.service.js';
import {
  bearer,
  clearUploads,
  connectSocket,
  createTestApp,
  nextEvent,
  noEvent,
  resetDatabase,
  signUpDriver,
  signUpPassenger,
  type SignedUp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
const open: Socket[] = [];

beforeAll(async () => {
  ctx = await createTestApp({ listen: true });
});

afterAll(async () => {
  await ctx?.app.close();
});

beforeEach(async () => {
  await resetDatabase(ctx.db);
  await clearUploads();
});

afterEach(() => {
  for (const socket of open.splice(0)) socket.close();
});

const TOWN_CENTRE = { lat: 45.6169, lng: -61.9986, address: '1 West St, Antigonish, NS' };
const ST_FX = { lat: 45.6175, lng: -61.9933, address: 'St. Francis Xavier University' };
/** About 1.1 km north of the town centre. */
const NEAR = { lat: 45.6269, lng: -61.9986 };

type Client = SignedUp & { socket: Socket };

const withSocket = async (account: SignedUp): Promise<Client> => {
  const socket = await connectSocket(ctx.url, account.token);
  open.push(socket);
  return { ...account, socket };
};

/** A Driver who is online at `at` and connected. */
const onlineDriver = async (at: { lat: number; lng: number } = TOWN_CENTRE) => {
  const driver = await signUpDriver(ctx);
  await ctx
    .http()
    .patch('/api/drivers/me/availability')
    .set(bearer(driver.token))
    .send({ available: true, lat: at.lat, lng: at.lng })
    .expect(200);
  return withSocket(driver);
};

const connectedPassenger = async () => withSocket(await signUpPassenger(ctx, { fullName: 'Jane Q. Doe' }));

const book = async (passenger: SignedUp, origin: object = ST_FX) => {
  const { body } = await ctx
    .http()
    .post('/api/trips')
    .set(bearer(passenger.token))
    .send({ origin, destination: TOWN_CENTRE })
    .expect(201);
  return body.data.id as string;
};

const post = (token: string, path: string, body?: object) =>
  ctx.http().post(path).set(bearer(token)).send(body);

// ------------------------------------------------------------------ trip:request
describe('trip:request', () => {
  it('reaches an online Driver with the TripRequest payload', async () => {
    const driver = await onlineDriver(TOWN_CENTRE);
    const passenger = await connectedPassenger();

    const received = nextEvent(driver.socket, 'trip:request');
    const tripId = await book(passenger);
    expect(await received).toEqual({
      tripId,
      pickup: ST_FX,
      distanceKm: 0.4,
      passengerName: 'Jane',
      expiresAt: expect.any(String),
    });
  });

  it('each Driver gets the distance from their own position', async () => {
    const atCentre = await onlineDriver(TOWN_CENTRE);
    const north = await onlineDriver(NEAR);
    const passenger = await connectedPassenger();

    const forCentre = nextEvent(atCentre.socket, 'trip:request');
    const forNorth = nextEvent(north.socket, 'trip:request');
    await book(passenger, TOWN_CENTRE);
    expect((await forCentre).distanceKm).toBe(0);
    expect((await forNorth).distanceKm).toBe(1.1);
  });

  it('is not sent to offline Drivers, busy Drivers or Passengers', async () => {
    const offline = await withSocket(await signUpDriver(ctx));
    const busy = await onlineDriver();
    const other = await connectedPassenger();
    const first = await connectedPassenger();
    const firstTrip = await book(first);
    await post(busy.token, `/api/trips/${firstTrip}/accept`).expect(200);

    const passenger = await connectedPassenger();
    const checks = [
      noEvent(offline.socket, 'trip:request'),
      noEvent(busy.socket, 'trip:request'),
      noEvent(other.socket, 'trip:request'),
      noEvent(passenger.socket, 'trip:request'),
    ];
    await book(passenger);
    await Promise.all(checks);
  });

  it('reaches every device the Driver is connected on', async () => {
    const driver = await onlineDriver();
    const secondDevice = await withSocket(driver);
    const passenger = await connectedPassenger();

    const both = Promise.all([nextEvent(driver.socket, 'trip:request'), nextEvent(secondDevice.socket, 'trip:request')]);
    const tripId = await book(passenger);
    expect((await both).map((r) => r.tripId)).toEqual([tripId, tripId]);
  });
});

// ------------------------------------------------------------------ trip:withdrawn and trip:no_driver
describe('trip:withdrawn', () => {
  it('PASSENGER_CANCELLED when the Passenger cancels', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);

    const withdrawn = nextEvent(driver.socket, 'trip:withdrawn');
    await post(passenger.token, `/api/trips/${tripId}/cancel`, { reason: 'CHANGED_MIND' }).expect(200);
    expect(await withdrawn).toEqual({ tripId, reason: 'PASSENGER_CANCELLED' });
  });

  it('ACCEPTED_BY_ANOTHER_DRIVER to the other Drivers, not to the one who accepted', async () => {
    const winner = await onlineDriver();
    const other = await onlineDriver(NEAR);
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);

    const forOther = nextEvent(other.socket, 'trip:withdrawn');
    const notForWinner = noEvent(winner.socket, 'trip:withdrawn');
    await post(winner.token, `/api/trips/${tripId}/accept`).expect(200);
    expect(await forOther).toEqual({ tripId, reason: 'ACCEPTED_BY_ANOTHER_DRIVER' });
    await notForWinner;
  });

  it('EXPIRED to Drivers, and trip:no_driver to the Passenger, when nobody accepts in time', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);
    await ctx.db.query(`UPDATE trips SET requested_at = now() - interval '10 minutes'`);

    const withdrawn = nextEvent(driver.socket, 'trip:withdrawn');
    const noDriver = nextEvent(passenger.socket, 'trip:no_driver');
    await ctx.app.get(TripExpiryService).expireStaleRequests();
    expect(await withdrawn).toEqual({ tripId, reason: 'EXPIRED' });
    expect(await noDriver).toEqual({ tripId });
  });

  it('trip:no_driver goes only to the Passenger who booked', async () => {
    const passenger = await connectedPassenger();
    const bystander = await connectedPassenger();
    await book(passenger);
    await ctx.db.query(`UPDATE trips SET requested_at = now() - interval '10 minutes'`);

    const notForBystander = noEvent(bystander.socket, 'trip:no_driver');
    await ctx.app.get(TripExpiryService).expireStaleRequests();
    await notForBystander;
  });
});

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

// ------------------------------------------------------------------ Passenger trip updates
describe('trip:accepted, trip:arrived, trip:started, trip:completed', () => {
  it('trip:accepted brings the Driver, their vehicle and an ETA to the pickup', async () => {
    // The Driver is about 1.1 km from the pickup: 2.2 minutes at 30 km/h.
    const driver = await onlineDriver(NEAR);
    const passenger = await connectedPassenger();
    const tripId = await book(passenger, TOWN_CENTRE);

    const accepted = nextEvent(passenger.socket, 'trip:accepted');
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);
    expect(await accepted).toEqual({
      tripId,
      driver: {
        id: driver.user.id,
        fullName: 'John Smith',
        phone: driver.user.phone,
        photoUrl: expect.stringMatching(/\/api\/files\/photos\//),
        vehicle: {
          make: 'Toyota',
          model: 'Corolla',
          colour: 'Silver',
          plateNumber: driver.user.driverDetails!.vehicle.plateNumber,
        },
      },
      etaSeconds: 133,
    });
  });

  it('etaSeconds is null when the Driver has never reported a position', async () => {
    const driver = await withSocket(await signUpDriver(ctx));
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);

    const accepted = nextEvent(passenger.socket, 'trip:accepted');
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);
    expect((await accepted).etaSeconds).toBeNull();
  });

  it('each step reaches the Passenger with its time, and the fare at the end', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);

    const arrived = nextEvent(passenger.socket, 'trip:arrived');
    await post(driver.token, `/api/trips/${tripId}/arrive`).expect(200);
    expect(await arrived).toEqual({ tripId, status: 'DRIVER_ARRIVED', at: expect.any(String) });

    const started = nextEvent(passenger.socket, 'trip:started');
    await post(driver.token, `/api/trips/${tripId}/start`).expect(200);
    expect(await started).toEqual({ tripId, status: 'IN_PROGRESS', at: expect.any(String) });

    const completed = nextEvent(passenger.socket, 'trip:completed');
    const done = await post(driver.token, `/api/trips/${tripId}/complete`).expect(200);
    expect(await completed).toEqual({
      tripId,
      fare: { amount: 8, currency: 'CAD' },
      completedAt: done.body.data.completedAt,
    });
  });

  it('the event times match the trip the REST API returns', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);

    const arrived = nextEvent(passenger.socket, 'trip:arrived');
    const res = await post(driver.token, `/api/trips/${tripId}/arrive`).expect(200);
    expect((await arrived).at).toBe(res.body.data.arrivedAt);
  });

  it('only the Passenger on the trip is told', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const bystander = await connectedPassenger();
    const tripId = await book(passenger);

    const checks = [noEvent(bystander.socket, 'trip:accepted'), noEvent(driver.socket, 'trip:accepted')];
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);
    await Promise.all(checks);
  });

  it('a failed step sends nothing', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);

    const nothing = noEvent(passenger.socket, 'trip:started');
    await post(driver.token, `/api/trips/${tripId}/start`).expect(409);
    await nothing;
  });
});

// ------------------------------------------------------------------ driver:location
describe('driver:location', () => {
  const sendLocation = (socket: Socket, body: unknown) => socket.timeout(2000).emitWithAck('driver:location', body);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('stores an online Driver’s position and acknowledges it', async () => {
    const driver = await onlineDriver(TOWN_CENTRE);
    const ack = await sendLocation(driver.socket, { ...NEAR, heading: 90 });
    expect(ack).toEqual({ success: true, message: 'Location updated', data: { accepted: true } });

    const [row] = await ctx.db.query('SELECT last_lat, last_lng FROM driver_details WHERE user_id = $1', [
      driver.user.id,
    ]);
    expect(row).toEqual({ last_lat: NEAR.lat, last_lng: NEAR.lng });
  });

  it('moves the Driver on the Passenger map (GET /drivers/active)', async () => {
    const driver = await onlineDriver({ lat: 45.8419, lng: -61.9986 });
    const passenger = await signUpPassenger(ctx);
    const active = () =>
      ctx.http().get(`/api/drivers/active?lat=${TOWN_CENTRE.lat}&lng=${TOWN_CENTRE.lng}`).set(bearer(passenger.token));
    expect((await active().expect(200)).body.data).toEqual([]);

    await sendLocation(driver.socket, NEAR);
    expect((await active().expect(200)).body.data[0]).toMatchObject({ driverId: driver.user.id, location: NEAR });
  });

  it('is not stored while the Driver is offline', async () => {
    const driver = await withSocket(await signUpDriver(ctx));
    await sendLocation(driver.socket, NEAR);
    const [row] = await ctx.db.query('SELECT last_lat FROM driver_details WHERE user_id = $1', [driver.user.id]);
    expect(row.last_lat).toBeNull();
  });

  it('during a trip, reaches the Passenger with an ETA to the pickup, then to the destination', async () => {
    const driver = await onlineDriver(NEAR);
    const passenger = await connectedPassenger();
    // Pickup at St. F.X., destination the town centre.
    const tripId = await book(passenger, ST_FX);
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);

    const toPickup = nextEvent(passenger.socket, 'driver:location');
    await sendLocation(driver.socket, { ...TOWN_CENTRE, heading: 45 });
    // 0.418 km at 30 km/h.
    expect(await toPickup).toEqual({ tripId, lat: TOWN_CENTRE.lat, lng: TOWN_CENTRE.lng, heading: 45, etaSeconds: 50 });

    await post(driver.token, `/api/trips/${tripId}/arrive`).expect(200);
    await post(driver.token, `/api/trips/${tripId}/start`).expect(200);
    await wait(1000);
    const toDestination = nextEvent(passenger.socket, 'driver:location');
    await sendLocation(driver.socket, ST_FX);
    expect(await toDestination).toEqual({ tripId, lat: ST_FX.lat, lng: ST_FX.lng, etaSeconds: 50 });
  });

  it('is not forwarded to anyone when the Driver has no active trip, or after it completes', async () => {
    const driver = await onlineDriver();
    const passenger = await connectedPassenger();
    const tripId = await book(passenger);
    await post(driver.token, `/api/trips/${tripId}/accept`).expect(200);
    for (const step of ['arrive', 'start', 'complete']) {
      await post(driver.token, `/api/trips/${tripId}/${step}`).expect(200);
    }

    const nothing = noEvent(passenger.socket, 'driver:location');
    await sendLocation(driver.socket, NEAR);
    await nothing;
  });

  it('ignores updates sent more than once a second', async () => {
    const driver = await onlineDriver(TOWN_CENTRE);
    await sendLocation(driver.socket, NEAR);
    const ack = await sendLocation(driver.socket, ST_FX);
    expect(ack).toEqual({
      success: true,
      message: 'Ignored: send at most one location per second',
      data: { accepted: false },
    });
    const [row] = await ctx.db.query('SELECT last_lat FROM driver_details WHERE user_id = $1', [driver.user.id]);
    expect(row.last_lat).toBe(NEAR.lat);

    await wait(1000);
    expect((await sendLocation(driver.socket, ST_FX)).data).toEqual({ accepted: true });
  });

  it.each([
    [{}, [
      { field: 'lat', message: 'Latitude is required' },
      { field: 'lng', message: 'Longitude is required' },
    ]],
    [{ lat: 95, lng: -61.9 }, [{ field: 'lat', message: 'Latitude must be between -90 and 90' }]],
    [{ lat: 45.6, lng: -61.9, heading: 400 }, [{ field: 'heading', message: 'Heading must be between 0 and 360' }]],
  ])('invalid %j gets an "exception" event with the field errors', async (body, details) => {
    const driver = await onlineDriver();
    const error = nextEvent(driver.socket, 'exception');
    driver.socket.emit('driver:location', body);
    expect(await error).toEqual({
      success: false,
      message: 'Request failed validation',
      error: { statusCode: 400, status: 'Bad Request', details },
    });
  });

  it('a Passenger cannot send a Driver location', async () => {
    const passenger = await connectedPassenger();
    const error = nextEvent(passenger.socket, 'exception');
    passenger.socket.emit('driver:location', NEAR);
    expect(await error).toEqual({
      success: false,
      message: 'Your account role is not allowed to perform this action',
      error: { statusCode: 403, status: 'Forbidden' },
    });
  });
});

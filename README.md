# Antigonish Ride-Hailing API

NestJS 12 + PostgreSQL 17 + TypeORM backend for the API contract in
[`ride-hailing-api.yaml`](ride-hailing-api.yaml).

**Status: every REST endpoint and WebSocket event in the spec is built**
(Auth, Profile, Drivers, Fares, Trips, Driver Trips and the real-time trip
events). Push notifications are not built yet.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/register/passenger` | public | JSON body |
| `POST /api/auth/register/driver` | public | `multipart/form-data` with `licenceImage`, `insuranceDocument`, `photo` |
| `POST /api/auth/login` | public | |
| `POST /api/auth/logout` | Bearer JWT | 200 |
| `GET /api/users/me` | Bearer JWT | |
| `PATCH /api/users/me` | Bearer JWT | JSON body, `fullName` only |
| `PUT /api/users/me/photo` | Bearer JWT | `multipart/form-data` with `photo` |
| `GET /api/health` | public | 200 when Postgres and file storage are reachable, else 503 |
| `GET /api/files/photos/:name` | signed link | the `photoUrl` from a profile; not built by clients |
| `POST /api/trips` | Passenger | one active trip at a time; 422 outside the service area |
| `GET /api/trips` | Passenger or Driver | `?status=A,B&page=0&size=20`, newest first |
| `GET /api/trips/active` | Passenger or Driver | `data: null` when there is none |
| `GET /api/trips/:tripId` | Passenger or Driver on the trip | 404 for anyone else |
| `POST /api/trips/:tripId/cancel` | Passenger | only while `REQUESTED`; `{ reason, note? }` |
| `PATCH /api/drivers/me/availability` | Driver | `{ available, lat?, lng? }`; position required to go online |
| `GET /api/drivers/active` | Passenger | `?lat=&lng=&radiusKm=5`; online, free Drivers for the map |
| `POST /api/fares/quote` | Passenger | fixed fare and `withinServiceArea` |
| `GET /api/trips/requests` | Driver | `?lat=&lng=` (Driver's position); nearest first |
| `POST /api/trips/:tripId/accept` | Driver | first Driver wins; one active trip per Driver |
| `POST /api/trips/:tripId/decline` | Driver | hides the request from this Driver |
| `POST /api/trips/:tripId/arrive` | Driver on the trip | `ACCEPTED` → `DRIVER_ARRIVED` |
| `POST /api/trips/:tripId/start` | Driver on the trip | `DRIVER_ARRIVED` → `IN_PROGRESS` |
| `POST /api/trips/:tripId/complete` | Driver on the trip | `IN_PROGRESS` → `COMPLETED` |

## Running it

Requires Docker. Node 24 is needed only to run outside Docker or to run tests.

```bash
cp .env.example .env          # then set JWT_SECRET (openssl rand -base64 48)
docker compose up -d --build  # API on http://localhost:$PORT/api (default 3000), Postgres on localhost:5433
```

Migrations run automatically when the API starts.

### Local development (API on the host, Postgres in Docker)

```bash
npm install
docker compose up -d db
npm run start:dev
```

Postgres is exposed on **5433** (not 5432) so it does not clash with other
local Postgres containers.

## Real-time events (WebSocket)

Socket.IO v4 on the same address as the API, without `/api`
(e.g. `https://<service>.onrender.com`, path `/socket.io`). Connect with the
access token from login or registration:

| Direction | Event | When |
|---|---|---|
| Driver → server | `driver:location` `{ lat, lng, heading? }` | every few seconds while online or on a trip (acked with `{ accepted }`; max one per second) |
| Server → Driver | `trip:request` | a trip is booked (online Drivers not on a trip) |
| Server → Driver | `trip:withdrawn` `{ tripId, reason }` | the request was cancelled, taken by another Driver, or expired |
| Server → Passenger | `trip:accepted` `{ tripId, driver, etaSeconds }` | a Driver accepted |
| Server → Passenger | `driver:location` `{ tripId, lat, lng, heading?, etaSeconds }` | the Driver moved, during the trip |
| Server → Passenger | `trip:arrived`, `trip:started` `{ tripId, status, at }` | the Driver arrived / started the ride |
| Server → Passenger | `trip:completed` `{ tripId, fare, completedAt }` | the ride ended |
| Server → Passenger | `trip:no_driver` `{ tripId }` | nobody accepted within 2 minutes; the trip is cancelled |
| Server → client | `exception` | a message the client sent was rejected (error envelope) |

**Mobile app (React Native / Expo, `socket.io-client`):**

```ts
import { io } from 'socket.io-client';

const socket = io(API_URL, {          // e.g. https://ride-hailing-api.onrender.com
  auth: { token: accessToken },
  transports: ['websocket'],
});

socket.on('connect', () => refreshActiveTrip());   // re-sync on every (re)connect
socket.on('connect_error', (err) => {
  if (err.message === 'Missing or expired access token') signOut();
});

// Passenger
socket.on('trip:accepted', ({ driver, etaSeconds }) => showDriver(driver, etaSeconds));
socket.on('driver:location', ({ lat, lng, heading, etaSeconds }) => moveCar(lat, lng, heading, etaSeconds));
socket.on('trip:completed', ({ fare }) => showFare(fare));

// Driver
socket.on('trip:request', (request) => showRequestAlert(request));
socket.on('trip:withdrawn', ({ tripId }) => hideRequestAlert(tripId));
setInterval(async () => {
  const { coords } = await getCurrentPosition();
  socket.emit('driver:location', { lat: coords.latitude, lng: coords.longitude, heading: coords.heading });
}, 5000);
```

**Flutter (`socket_io_client`):**

```dart
final socket = IO.io(apiUrl, IO.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})
    .build());
socket.onConnect((_) => refreshActiveTrip());
socket.on('trip:accepted', (data) => showDriver(data['driver'], data['etaSeconds']));
socket.emit('driver:location', {'lat': lat, 'lng': lng, 'heading': heading});
```

Events are a live layer on top of REST, which stays the source of truth.
After connecting or reconnecting (app back in the foreground, network change,
or Render's free service waking up), re-fetch `GET /api/trips/active`, and
Drivers `GET /api/trips/requests`. A WebSocket only delivers while the app is
open; push notifications for a closed app are not built yet.

## Deploying to Render

[`render.yaml`](render.yaml) is a Render Blueprint that creates the API (Docker,
free web service) and a free Postgres database, with `/api/health` as the
health check. Uploaded files are stored in **MongoDB Atlas (GridFS)**, because
a free web service's disk is wiped on every deploy and restart. Photo links
use the service's public `onrender.com` address automatically.

**1. MongoDB Atlas (free M0 cluster)**

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. *Database Access*: add a database user with a password.
3. *Network Access*: allow `0.0.0.0/0`. Render's free services have no fixed
   outbound IP; access is still protected by the user and password.
4. *Connect → Drivers*: copy the connection string and **add a database name**
   before the `?`, e.g.
   `mongodb+srv://app:<password>@cluster0.xxxxx.mongodb.net/ride_hailing?retryWrites=true&w=majority`.
   The API refuses to start without a database name.

**2. Render**

1. *New → Blueprint*, connect GitHub and pick this repository (branch `main`).
2. When asked for `MONGODB_URI`, paste the connection string from step 1.
3. *Apply*. Render creates the database and builds the Docker image; the first
   deploy takes a few minutes. Migrations run automatically on startup.

**3. Check**

- `https://<service>.onrender.com/api/health` returns `"status": "ok"` with
  `database` and `storage` both `up`.
- Register a Driver: the `photoUrl` in the response starts with your
  `onrender.com` address and opens in a browser.

Every push to `main` deploys again. `JWT_SECRET` is generated by Render;
changing it signs everyone out and invalidates current photo links.

**Free tier limits**

- The web service sleeps after 15 minutes without traffic; the next request
  takes about a minute while it starts.
- The free Postgres database is **deleted after 30 days** (Render emails a
  warning first). Upgrade it in the dashboard to keep the data.
- MongoDB Atlas M0 holds 512 MB of files.
- Background jobs, like expiring unanswered trip requests, only run while the
  service is awake.

To try the Render setup locally: `docker compose up -d db mongo`, then run the
API with `STORAGE_DRIVER=gridfs` and
`MONGODB_URI=mongodb://localhost:27018/ride_hailing`.

## Tests

```bash
npm test            # unit tests (no database)
docker compose up -d db
npm run test:e2e    # boots the real app against the ride_hailing_test database
docker compose up -d mongo
npm run test:e2e:gridfs  # the same suite with uploads stored in MongoDB GridFS
```

The e2e suite covers every auth endpoint: success shapes against the spec
schemas, each validation, 401 and 409 case with the spec's exact error
messages, token revocation, file-type checks, and the race between two
identical registrations.

The `ride_hailing_test` database is created by
`docker/postgres/init/` the first time the Postgres volume is created. If your
volume is older than that script, create it once:
`docker compose exec db createdb -U ride_hailing ride_hailing_test`.

## Project layout

```
src/
  main.ts, app.module.ts, app.setup.ts   bootstrap; app.setup is shared with tests
  config/env.validation.ts               env vars checked at startup
  common/                                response envelope (interceptor + error filter), validation helpers, @Public(), @ResponseMessage()
  database/                              TypeORM options, CLI data source, migrations
  users/                                 User + DriverDetails entities, profile endpoints
  auth/                                  controller, service, JWT and roles guards, token revocation, DTOs
  drivers/                               online status, Driver positions, active Drivers for the map
  fares/                                 fixed fare, service area, distance (pricing.ts), fare quotes
  trips/                                 Passenger and Driver trip endpoints, request expiry
  storage/                               file storage (disk or MongoDB GridFS) and signed photo links
  health/                                GET /api/health
  realtime/                              Socket.IO gateway, trip events -> WebSocket events, driver:location
test/                                    e2e tests (Vitest + Supertest)
```

## Design notes

- **Data model.** `users` holds fields shared by both roles. `driver_details`
  (1:1, same primary key) holds the licence, vehicle and availability. A Driver
  is always created with both rows in one transaction. The API mapper refuses
  to return a Driver without details, which enforces the spec rule.
- **Response envelope.** Every response is wrapped. Success:
  `{ success: true, message, data }`, where `data` is the handler's return value
  (`null` if it returns nothing) and `message` comes from `@ResponseMessage()`
  on the handler. Error, including validation, 404 and malformed JSON:
  `{ success: false, message, error: { statusCode, status, details? } }`.
- **JWT.** HS256, 24 h (`expiresIn: 86400`), with payload `sub`, `role` and `jti`.
  Logout stores the token's `jti` in `revoked_tokens`, which revokes that token
  only. The user's other devices stay signed in.
- **Passwords.** Hashed with bcrypt (cost 12 by default). Login takes the same
  time whether or not the email exists.
- **Uploads.** File types are checked from the file's bytes, not its
  Content-Type header. The limit is 5 MB per file. The bytes go to a
  `FileStore`: local disk under `UPLOAD_DIR` (default) or MongoDB GridFS
  (`STORAGE_DRIVER=gridfs`). Nothing is served as a static file. Licence and insurance documents are never served
  at all.
- **Profile photos.** The database stores the storage key, not a URL. Each
  profile or auth response carries a fresh `photoUrl` signed with HMAC-SHA256
  (key derived from `JWT_SECRET`) that expires after 1-2x
  `FILE_URL_TTL_SECONDS` (default 900). Links point at `PUBLIC_BASE_URL`,
  which defaults to `http://localhost:<PORT>`. The expiry is rounded to a window so
  the URL stays the same for a while and clients can cache the image. Bad,
  expired and unknown links all get the same 403, so the endpoint does not
  reveal which photos exist. Replacing a photo deletes the old file, so its
  old links stop working.
- **Roles.** `@Roles(Role.PASSENGER)` on an endpoint restricts it; the global
  `RolesGuard` runs after the JWT guard and returns the spec's 403.
- **Trips.** One active trip per Passenger (and per Driver) is enforced by
  partial unique indexes, so simultaneous bookings cannot both succeed. The
  fare (fixed 8.00 CAD) is stored on each trip. The service area is a 10 km
  radius around the town centre (`src/trips/pricing.ts`). Cancelling is a
  single conditional update, so it cannot race a Driver accepting.
- **Trip requests.** A request is open for `TRIP_REQUEST_TTL_SECONDS`
  (default 120). Listing and accepting check the expiry directly; a background
  sweep every `TRIP_EXPIRY_SWEEP_SECONDS` (default 10, 0 = off) cancels expired
  trips with `NO_DRIVER_FOUND`. Before accepting, a Driver sees only the pickup,
  the distance and the Passenger's first name. Declines are stored in
  `trip_declines`.
- **Trip status steps.** Accept, arrive, start and complete are each one
  conditional `UPDATE` on the expected status (and Driver), so steps cannot be
  skipped or repeated and concurrent requests cannot both succeed.
- **Trip visibility.** `toTripView()` builds every trip response for the
  viewer: the Passenger never sees the Driver on a cancelled trip; the Driver
  sees the Passenger only while the trip is active or completed, and never the
  Passenger's cancellation reason.
- **Driver presence.** Going online records the Driver's position; going
  offline or logging out clears it, and positions are only recorded while
  online. Positions arrive as `driver:location` over the WebSocket, and also
  from every `GET /api/trips/requests?lat=&lng=`. The Passenger map shows online Drivers who are
  not on a trip and reported a position in the last 5 minutes. Online status
  does not yet limit who sees trip requests.
- **Real-time.** The trip services publish domain events (`TripEvents`) after
  each change; `TripNotifier` turns them into Socket.IO events, so push
  notifications can subscribe later without touching trip code. Sockets are
  authenticated on connect and joined to a room per user (and `drivers`).
- **Fares.** `FaresService.quote()` prices both quotes and bookings, so the
  quoted fare is always the fare charged.
- **Normalisation.** Email is stored in lower case, and plate numbers in upper
  case with spaces collapsed, so duplicates are caught regardless of case.

## Not built yet

- `deviceToken` in the logout body is validated but not used yet, because push
  tokens are not registered until push notifications are built.
- Push notifications (e.g. Firebase) for `trip:request` and the Passenger
  trip events when the app is closed. The WebSocket events only reach an open
  app.
- Several API instances: rooms live in one process. Running more than one
  instance needs the Socket.IO Redis adapter.
- Online-only requests: any Driver without an active trip can see and accept
  requests, whether online or not.

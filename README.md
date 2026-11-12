# Antigonish Ride-Hailing API

NestJS 12 + PostgreSQL 17 + TypeORM backend for the API contract in
[`ride-hailing-api.yaml`](ride-hailing-api.yaml).

**Status: stage 2 in progress.** Project setup, database, the `User` model,
the four `Auth` endpoints, the three `Profile` endpoints, the five Passenger
`Trips` endpoints and the six `Driver Trips` endpoints. The `Drivers` and
`Fares` endpoints and the WebSocket events are not built yet.

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/register/passenger` | public | JSON body |
| `POST /api/auth/register/driver` | public | `multipart/form-data` with `licenceImage`, `insuranceDocument`, `photo` |
| `POST /api/auth/login` | public | |
| `POST /api/auth/logout` | Bearer JWT | 200 |
| `GET /api/users/me` | Bearer JWT | |
| `PATCH /api/users/me` | Bearer JWT | JSON body, `fullName` only |
| `PUT /api/users/me/photo` | Bearer JWT | `multipart/form-data` with `photo` |
| `GET /api/files/photos/:name` | signed link | the `photoUrl` from a profile; not built by clients |
| `POST /api/trips` | Passenger | one active trip at a time; 422 outside the service area |
| `GET /api/trips` | Passenger or Driver | `?status=A,B&page=0&size=20`, newest first |
| `GET /api/trips/active` | Passenger or Driver | `data: null` when there is none |
| `GET /api/trips/:tripId` | Passenger or Driver on the trip | 404 for anyone else |
| `POST /api/trips/:tripId/cancel` | Passenger | only while `REQUESTED`; `{ reason, note? }` |
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

## Tests

```bash
npm test            # unit tests (no database)
docker compose up -d db
npm run test:e2e    # boots the real app against the ride_hailing_test database
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
  users/                                 User + DriverDetails entities, UserProfile mapping
  auth/                                  controller, service, JWT guard, token revocation, DTOs
  storage/                               local file storage for uploads
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
  Content-Type header. The limit is 5 MB per file. Nothing in `UPLOAD_DIR` is
  served as a static file. Licence and insurance documents are never served
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
- **Normalisation.** Email is stored in lower case, and plate numbers in upper
  case with spaces collapsed, so duplicates are caught regardless of case.

## Not built yet

- `deviceToken` in the logout body is validated but not used yet, because push
  tokens are not registered until push notifications are built.
- Real-time events and push notifications (`trip:request`, `trip:accepted`,
  ...). Drivers find requests through `GET /api/trips/requests` for now, and
  send their position with it until live location exists.
- Driver online status: `PATCH /drivers/me/availability` is not built, so any
  Driver without an active trip can see and accept requests.

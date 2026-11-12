# Antigonish Ride-Hailing API

NestJS 12 + PostgreSQL 17 + TypeORM backend for the API contract in
[`ride-hailing-api.yaml`](ride-hailing-api.yaml).

**Status: stage 2 in progress.** Project setup, database, the `User` model,
the four `Auth` endpoints and the three `Profile` endpoints. Every other
endpoint in the spec returns 404 for now.

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

## Running it

Requires Docker. Node 24 is needed only to run outside Docker or to run tests.

```bash
cp .env.example .env          # then set JWT_SECRET (openssl rand -base64 48)
docker compose up -d --build  # API on http://localhost:3000/api, Postgres on localhost:5433
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
  `FILE_URL_TTL_SECONDS` (default 900). The expiry is rounded to a window so
  the URL stays the same for a while and clients can cache the image. Bad,
  expired and unknown links all get the same 403, so the endpoint does not
  reveal which photos exist. Replacing a photo deletes the old file, so its
  old links stop working.
- **Normalisation.** Email is stored in lower case, and plate numbers in upper
  case with spaces collapsed, so duplicates are caught regardless of case.

## Not in stage 1

- `deviceToken` in the logout body is validated but not used yet, because push
  tokens are not registered until push notifications are built.
- No role-based guard yet: none of the auth endpoints is role-restricted.
  It comes with the first Passenger-only or Driver-only endpoint.

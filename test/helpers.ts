import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

export interface TestContext {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  db: DataSource;
}

/** Boots the real app (same module, filters, pipes and prefix as production). */
export async function createTestApp(): Promise<TestContext> {
  await rm(process.env.UPLOAD_DIR!, { recursive: true, force: true });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    db: app.get(DataSource),
  };
}

export async function resetDatabase(db: DataSource): Promise<void> {
  await db.query('TRUNCATE "trips", "revoked_tokens", "driver_details", "users" CASCADE');
}

export async function clearUploads(): Promise<void> {
  for (const sub of ['public', 'private']) {
    await rm(join(process.env.UPLOAD_DIR!, sub), { recursive: true, force: true });
  }
}

/** Lists files written under UPLOAD_DIR/<sub>, recursively. */
export async function listUploads(sub: string): Promise<string[]> {
  try {
    const entries = await readdir(join(process.env.UPLOAD_DIR!, sub), {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

// Minimal files with valid magic bytes.
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
export const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

export const passengerBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+19025551234',
  password: 'correct-horse',
  ...overrides,
});

export const driverFields = (overrides: Record<string, string> = {}) => ({
  fullName: 'John Smith',
  email: 'john@example.com',
  phone: '+19025559876',
  password: 'driver-pass-1',
  licenceNumber: 'NS1234567',
  vehicleMake: 'Toyota',
  vehicleModel: 'Corolla',
  vehicleColour: 'Silver',
  plateNumber: 'ABC 123',
  ...overrides,
});

type FileSpec = { buffer: Buffer; filename: string; contentType: string };

export const defaultDriverFiles = (): Record<string, FileSpec> => ({
  licenceImage: { buffer: JPEG, filename: 'licence.jpg', contentType: 'image/jpeg' },
  insuranceDocument: { buffer: PDF, filename: 'insurance.pdf', contentType: 'application/pdf' },
  photo: { buffer: PNG, filename: 'me.png', contentType: 'image/png' },
});

/** Sends a multipart driver registration. Pass `null` for a file to omit it. */
export function registerDriver(
  ctx: TestContext,
  fields: Record<string, string> = driverFields(),
  files: Record<string, FileSpec | null> = defaultDriverFiles(),
) {
  let req = ctx.http().post('/api/auth/register/driver');
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  for (const [key, file] of Object.entries(files)) {
    if (file) req = req.attach(key, file.buffer, { filename: file.filename, contentType: file.contentType });
  }
  return req;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A signed, expiring profile photo link, as returned in `photoUrl`. */
export const SIGNED_PHOTO_URL =
  /^http:\/\/localhost:3000\/api\/files\/photos\/[0-9a-f-]{36}\.(jpg|png)\?expires=\d+&sig=[A-Za-z0-9_-]{43}$/;

/** The path and query of a URL, for requesting it through supertest. */
export const pathOf = (url: string): string => {
  const u = new URL(url);
  return u.pathname + u.search;
};

export interface SignedUp {
  token: string;
  user: { id: string; fullName: string; phone: string; photoUrl: string | null };
}

let accounts = 0;

/** Registers a Passenger with a unique email and phone. */
export async function signUpPassenger(
  ctx: TestContext,
  overrides: Record<string, unknown> = {},
): Promise<SignedUp> {
  const n = ++accounts;
  const res = await ctx
    .http()
    .post('/api/auth/register/passenger')
    .send(passengerBody({ email: `passenger${n}@example.com`, phone: `+1902555${String(n).padStart(4, '0')}`, ...overrides }))
    .expect(201);
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

/** Registers a Driver with a unique email, phone and plate number. */
export async function signUpDriver(
  ctx: TestContext,
  overrides: Record<string, string> = {},
): Promise<SignedUp> {
  const n = ++accounts;
  const res = await registerDriver(
    ctx,
    driverFields({
      email: `driver${n}@example.com`,
      phone: `+1902666${String(n).padStart(4, '0')}`,
      plateNumber: `DRV ${n}`,
      ...overrides,
    }),
  ).expect(201);
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

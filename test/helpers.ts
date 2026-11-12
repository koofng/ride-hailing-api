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
  await db.query('TRUNCATE "revoked_tokens", "driver_details", "users" CASCADE');
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

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
  clearUploads,
  createTestApp,
  defaultDriverFiles,
  driverFields,
  ISO_DATE,
  JPEG,
  listUploads,
  passengerBody,
  pathOf,
  registerDriver,
  resetDatabase,
  SIGNED_PHOTO_URL,
  UUID,
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

const registerPassenger = (body: Record<string, unknown> = passengerBody()) =>
  ctx.http().post('/api/auth/register/passenger').send(body);

// ------------------------------------------------------------------ registerPassenger
describe('POST /api/auth/register/passenger', () => {
  it('201: creates the account and returns an AuthResponse', async () => {
    const res = await registerPassenger().expect(201);

    expect(res.body).toEqual({
      success: true,
      message: 'Passenger registered successfully',
      data: {
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 86400,
        user: {
          id: expect.stringMatching(UUID),
          role: 'PASSENGER',
          fullName: 'Jane Doe',
          email: 'jane@example.com',
          phone: '+19025551234',
          photoUrl: null,
          createdAt: expect.stringMatching(ISO_DATE),
          driverDetails: null,
        },
      },
    });
  });

  it('signs the user in: the returned token is accepted', async () => {
    const { body } = await registerPassenger().expect(201);
    await ctx
      .http()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);
  });

  it('stores a bcrypt hash, never the password', async () => {
    await registerPassenger().expect(201);
    const [row] = await ctx.db.query('SELECT password_hash FROM users');
    expect(row.password_hash).not.toBe('correct-horse');
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('correct-horse', row.password_hash)).toBe(true);
  });

  it('normalises email to lower case and trims text fields', async () => {
    const res = await registerPassenger(
      passengerBody({ email: '  Jane@Example.COM ', fullName: '  Jane Doe  ' }),
    ).expect(201);
    expect(res.body.data.user.email).toBe('jane@example.com');
    expect(res.body.data.user.fullName).toBe('Jane Doe');
  });

  it('ignores fields not in the spec (cannot self-assign role DRIVER)', async () => {
    const res = await registerPassenger(
      passengerBody({ role: 'DRIVER', id: '00000000-0000-0000-0000-000000000000' }),
    ).expect(201);
    expect(res.body.data.user.role).toBe('PASSENGER');
    expect(res.body.data.user.id).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('400: lists every invalid field', async () => {
    const res = await registerPassenger({}).expect(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Request failed validation',
      error: {
        statusCode: 400,
        status: 'Bad Request',
        details: expect.arrayContaining([
          { field: 'fullName', message: 'Full name is required' },
          { field: 'email', message: 'Email is required' },
          { field: 'phone', message: 'Phone number is required' },
          { field: 'password', message: 'Password is required' },
        ]),
      },
    });
    expect(res.body.error.details).toHaveLength(4);
  });

  it('400: invalid email uses the spec message', async () => {
    const res = await registerPassenger(passengerBody({ email: 'not-an-email' })).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'email', message: 'Must be a valid email address' },
    ]);
  });

  it.each([
    ['fullName', 'J', 'Full name must be between 2 and 100 characters'],
    ['fullName', 'x'.repeat(101), 'Full name must be between 2 and 100 characters'],
    ['password', 'short', 'Password must be at least 8 characters'],
    ['phone', '902-555-1234', 'Must be a valid phone number in international format, e.g. +19025551234'],
    ['fullName', 42, 'Full name must be text'],
  ])('400: %s = %j', async (field, value, message) => {
    const res = await registerPassenger(passengerBody({ [field]: value })).expect(400);
    expect(res.body.error.details).toEqual([{ field, message }]);
  });

  it('409: email already registered (case-insensitive)', async () => {
    await registerPassenger().expect(201);
    const res = await registerPassenger(
      passengerBody({ email: 'JANE@example.com', phone: '+19025550000' }),
    ).expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'An account with this email or phone number already exists',
      error: { statusCode: 409, status: 'Conflict' },
    });
  });

  it('409: phone already registered', async () => {
    await registerPassenger().expect(201);
    const res = await registerPassenger(passengerBody({ email: 'other@example.com' })).expect(409);
    expect(res.body.message).toBe('An account with this email or phone number already exists');
  });

  it('409: concurrent duplicate registrations create only one account', async () => {
    const results = await Promise.all([registerPassenger(), registerPassenger()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const [{ count }] = await ctx.db.query('SELECT count(*)::int AS count FROM users');
    expect(count).toBe(1);
  });
});

// ------------------------------------------------------------------ registerDriver
describe('POST /api/auth/register/driver', () => {
  it('201: creates the Driver with driverDetails and returns an AuthResponse', async () => {
    const res = await registerDriver(ctx).expect(201);

    expect(res.body).toEqual({
      success: true,
      message: 'Driver registered successfully',
      data: {
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 86400,
        user: {
          id: expect.stringMatching(UUID),
          role: 'DRIVER',
          fullName: 'John Smith',
          email: 'john@example.com',
          phone: '+19025559876',
          photoUrl: expect.stringMatching(SIGNED_PHOTO_URL),
          createdAt: expect.stringMatching(ISO_DATE),
          driverDetails: {
            licenceNumber: 'NS1234567',
            vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plateNumber: 'ABC 123' },
            available: false,
          },
        },
      },
    });
  });

  it('serves the profile photo only through its signed link, and never the documents', async () => {
    const { body } = await registerDriver(ctx).expect(201);
    const { photoUrl } = body.data.user;
    await ctx.http().get(pathOf(photoUrl)).expect(200).expect('Content-Type', /image\/png/);
    await ctx.http().get(new URL(photoUrl).pathname).expect(403);

    const [row] = await ctx.db.query(
      'SELECT licence_image_key, insurance_document_key FROM driver_details',
    );
    expect(row.licence_image_key).toMatch(/^private\//);
    expect(row.insurance_document_key).toMatch(/^private\//);
    for (const key of [row.licence_image_key, row.insurance_document_key]) {
      await ctx.http().get(`/uploads/${key}`).expect(404);
      await ctx.http().get(`/uploads/../${key}`).expect(404);
    }
  });

  it('normalises the plate number to upper case', async () => {
    const res = await registerDriver(ctx, driverFields({ plateNumber: '  abc   123 ' })).expect(201);
    expect(res.body.data.user.driverDetails.vehicle.plateNumber).toBe('ABC 123');
  });

  it('400: missing insurance document and plate number (spec example)', async () => {
    const fields = driverFields();
    delete (fields as Partial<typeof fields>).plateNumber;
    const res = await registerDriver(ctx, fields, {
      ...defaultDriverFiles(),
      insuranceDocument: null,
    }).expect(400);

    expect(res.body).toEqual({
      success: false,
      message: 'Driver registration failed validation',
      error: {
        statusCode: 400,
        status: 'Bad Request',
        details: expect.arrayContaining([
          { field: 'insuranceDocument', message: 'Proof of insurance is required' },
          { field: 'plateNumber', message: 'Plate number is required' },
        ]),
      },
    });
    expect(res.body.error.details).toHaveLength(2);
  });

  it('400: empty form lists every required field and file', async () => {
    const res = await registerDriver(ctx, {}, {}).expect(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(
      [
        'email', 'fullName', 'insuranceDocument', 'licenceImage', 'licenceNumber', 'password',
        'phone', 'photo', 'plateNumber', 'vehicleColour', 'vehicleMake', 'vehicleModel',
      ],
    );
  });

  it('400: rejects a file whose content is not really an image, whatever its Content-Type says', async () => {
    const res = await registerDriver(ctx, driverFields(), {
      ...defaultDriverFiles(),
      photo: { buffer: Buffer.from('<?php evil(); ?>'), filename: 'me.png', contentType: 'image/png' },
    }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'photo', message: 'Profile photo must be a JPEG or PNG image' },
    ]);
  });

  it('400: profile photo cannot be a PDF', async () => {
    const res = await registerDriver(ctx, driverFields(), {
      ...defaultDriverFiles(),
      photo: { buffer: Buffer.from('%PDF-1.4'), filename: 'me.pdf', contentType: 'application/pdf' },
    }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'photo', message: 'Profile photo must be a JPEG or PNG image' },
    ]);
  });

  it('400: file larger than 5 MB', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await registerDriver(ctx, driverFields(), {
      ...defaultDriverFiles(),
      licenceImage: { buffer: big, filename: 'licence.jpg', contentType: 'image/jpeg' },
    }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'licenceImage', message: 'File must be 5 MB or smaller' },
    ]);
  });

  it('writes no files when validation fails or the account already exists', async () => {
    await registerDriver(ctx).expect(201);
    const before = [...(await listUploads('private')), ...(await listUploads('public'))];
    expect(before).toHaveLength(3);

    await registerDriver(ctx, driverFields({ email: 'bad' })).expect(400);
    await registerDriver(ctx).expect(409);

    const after = [...(await listUploads('private')), ...(await listUploads('public'))];
    expect(after.sort()).toEqual(before.sort());
  });

  it('413: rejects uploads far above the limit before buffering them', async () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await registerDriver(ctx, driverFields(), {
      ...defaultDriverFiles(),
      photo: { buffer: huge, filename: 'me.jpg', contentType: 'image/jpeg' },
    }).expect(413);
    expect(res.body).toMatchObject({ success: false, error: { statusCode: 413, status: 'Payload Too Large' } });
  });

  it.each([
    ['email', { email: 'JOHN@example.com', phone: '+19025550001', plateNumber: 'NEW 001' }],
    ['phone', { email: 'new@example.com', plateNumber: 'NEW 002' }],
    ['plate number', { email: 'new@example.com', phone: '+19025550003', plateNumber: 'abc 123' }],
  ])('409: %s already registered', async (_label, overrides) => {
    await registerDriver(ctx).expect(201);
    const res = await registerDriver(ctx, driverFields(overrides)).expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'An account with this email, phone number or plate number already exists',
      error: {
        statusCode: 409,
        status: 'Conflict',
      },
    });
  });

  it('409: email already used by a Passenger account', async () => {
    await registerPassenger(passengerBody({ email: 'john@example.com' })).expect(201);
    await registerDriver(ctx).expect(409);
  });
});

// ------------------------------------------------------------------ login
describe('POST /api/auth/login', () => {
  const login = (body: Record<string, unknown>) =>
    ctx.http().post('/api/auth/login').send(body);

  it('200: Passenger gets an AuthResponse with driverDetails null', async () => {
    const registered = await registerPassenger().expect(201);
    const res = await login({ email: 'jane@example.com', password: 'correct-horse' }).expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'Logged in successfully',
      data: {
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 86400,
        user: registered.body.data.user,
      },
    });
    expect(res.body.data.user.driverDetails).toBeNull();
  });

  it('200: Driver gets an AuthResponse with driverDetails filled in', async () => {
    const registered = await registerDriver(ctx).expect(201);
    const res = await login({ email: 'john@example.com', password: 'driver-pass-1' }).expect(200);
    expect(res.body.data.user).toEqual(registered.body.data.user);
    expect(res.body.data.user.role).toBe('DRIVER');
    expect(res.body.data.user.driverDetails.vehicle.plateNumber).toBe('ABC 123');
  });

  it('accepts the email in any case', async () => {
    await registerPassenger().expect(201);
    await login({ email: ' JANE@Example.com', password: 'correct-horse' }).expect(200);
  });

  it('issues a token with the user id and role', async () => {
    const { body: reg } = await registerDriver(ctx).expect(201);
    const { body } = await login({ email: 'john@example.com', password: 'driver-pass-1' });
    const payload = jwt.decode(body.data.accessToken) as jwt.JwtPayload;
    expect(payload).toMatchObject({ sub: reg.data.user.id, role: 'DRIVER', jti: expect.stringMatching(UUID) });
    expect(payload.exp! - payload.iat!).toBe(86400);
  });

  it.each([
    ['wrong password', { email: 'jane@example.com', password: 'wrong-password' }],
    ['unknown email', { email: 'nobody@example.com', password: 'correct-horse' }],
  ])('401: %s gives the same message', async (_label, body) => {
    await registerPassenger().expect(201);
    const res = await login(body).expect(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Incorrect email or password',
      error: {
        statusCode: 401,
        status: 'Unauthorized',
      },
    });
  });

  it('400: missing or invalid fields', async () => {
    const res = await login({ email: 'nope' }).expect(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Request failed validation',
      error: {
        statusCode: 400,
        status: 'Bad Request',
        details: [
          { field: 'email', message: 'Must be a valid email address' },
          { field: 'password', message: 'Password is required' },
        ],
      },
    });
  });

  it('400: malformed JSON body', async () => {
    const res = await ctx
      .http()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Request body is not valid JSON',
      error: {
        statusCode: 400,
        status: 'Bad Request',
      },
    });
  });
});

// ------------------------------------------------------------------ logout
describe('POST /api/auth/logout', () => {
  const logout = (token?: string, body?: object) => {
    const req = ctx.http().post('/api/auth/logout');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  it('200: logs out with no body', async () => {
    const { body } = await registerPassenger().expect(201);
    const res = await logout(body.data.accessToken).expect(200);
    expect(res.body).toEqual({ success: true, message: 'Logged out successfully', data: null });
  });

  it('200: accepts a deviceToken in the body', async () => {
    const { body } = await registerPassenger().expect(201);
    await logout(body.data.accessToken, { deviceToken: 'fcm-token-123' }).expect(200);
  });

  it('invalidates the token that was used', async () => {
    const { body } = await registerPassenger().expect(201);
    await logout(body.data.accessToken).expect(200);
    const res = await logout(body.data.accessToken).expect(401);
    expect(res.body.message).toBe('Missing or expired access token');
  });

  it("does not invalidate the same user's other sessions", async () => {
    const { body: first } = await registerPassenger().expect(201);
    const { body: second } = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'jane@example.com', password: 'correct-horse' })
      .expect(200);
    await logout(first.data.accessToken).expect(200);
    await logout(second.data.accessToken).expect(200);
  });

  it('marks a Driver unavailable', async () => {
    const { body } = await registerDriver(ctx).expect(201);
    await ctx.db.query('UPDATE driver_details SET available = true');
    await logout(body.data.accessToken).expect(200);
    const [row] = await ctx.db.query('SELECT available FROM driver_details');
    expect(row.available).toBe(false);
  });

  it('400: deviceToken must be a string', async () => {
    const { body } = await registerPassenger().expect(201);
    const res = await logout(body.data.accessToken, { deviceToken: 123 }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'deviceToken', message: 'Device token must be text' },
    ]);
  });

  const UNAUTHORIZED = {
    success: false,
    message: 'Missing or expired access token',
    error: {
      statusCode: 401,
      status: 'Unauthorized',
    },
  };

  it('401: no token', async () => {
    const res = await logout().expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('401: malformed token', async () => {
    const res = await logout('not-a-jwt').expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('401: token signed with a different secret', async () => {
    const { body } = await registerPassenger().expect(201);
    const forged = jwt.sign(
      { sub: body.data.user.id, role: 'PASSENGER', jti: crypto.randomUUID() },
      'some-other-secret-that-is-long-enough-123',
      { expiresIn: 600 },
    );
    await logout(forged).expect(401);
  });

  it('401: expired token', async () => {
    const { body } = await registerPassenger().expect(201);
    const expired = jwt.sign(
      { sub: body.data.user.id, role: 'PASSENGER', jti: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_SECRET!,
    );
    const res = await logout(expired).expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('401: unsigned token (alg "none")', async () => {
    const { body } = await registerPassenger().expect(201);
    const unsigned = jwt.sign(
      { sub: body.data.user.id, role: 'PASSENGER', jti: crypto.randomUUID() },
      '',
      { algorithm: 'none', expiresIn: 600 },
    );
    await logout(unsigned).expect(401);
  });
});

// ------------------------------------------------------------------ error format
describe('error format', () => {
  it('unknown routes return 404 in the ErrorResponse envelope', async () => {
    const res = await ctx.http().get('/api/does-not-exist').expect(404);
    expect(res.body).toEqual({
      success: false,
      message: expect.any(String),
      error: {
        statusCode: 404,
        status: 'Not Found',
      },
    });
  });

  it('stage-2 endpoints are not built yet', async () => {
    await ctx.http().get('/api/drivers/active').expect(404);
    await ctx.http().post('/api/fares/quote').expect(404);
  });
});

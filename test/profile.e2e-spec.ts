import {
  clearUploads,
  createTestApp,
  ISO_DATE,
  passengerBody,
  registerDriver,
  resetDatabase,
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

/** Registers a Passenger and returns their access token and profile. */
const signUpPassenger = async () => {
  const res = await ctx
    .http()
    .post('/api/auth/register/passenger')
    .send(passengerBody())
    .expect(201);
  return { token: res.body.data.accessToken as string, user: res.body.data.user };
};

/** Registers a Driver and returns their access token and profile. */
const signUpDriver = async () => {
  const res = await registerDriver(ctx).expect(201);
  return { token: res.body.data.accessToken as string, user: res.body.data.user };
};

const UNAUTHORIZED = {
  success: false,
  message: 'Missing or expired access token',
  error: { statusCode: 401, status: 'Unauthorized' },
};

// ------------------------------------------------------------------ getMyProfile
describe('GET /api/users/me', () => {
  const getMe = (token?: string) => {
    const req = ctx.http().get('/api/users/me');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('200: Passenger gets their profile with driverDetails null', async () => {
    const { token } = await signUpPassenger();
    const res = await getMe(token).expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        id: expect.stringMatching(UUID),
        role: 'PASSENGER',
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+19025551234',
        photoUrl: null,
        createdAt: expect.stringMatching(ISO_DATE),
        driverDetails: null,
      },
    });
  });

  it('200: Driver gets their profile with driverDetails filled in', async () => {
    const { token, user } = await signUpDriver();
    const res = await getMe(token).expect(200);

    expect(res.body.data).toEqual(user);
    expect(res.body.data.driverDetails).toEqual({
      licenceNumber: 'NS1234567',
      vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plateNumber: 'ABC 123' },
      available: false,
    });
  });

  it('reflects the current availability, not the value at sign-up', async () => {
    const { token } = await signUpDriver();
    await ctx.db.query('UPDATE driver_details SET available = true');
    const res = await getMe(token).expect(200);
    expect(res.body.data.driverDetails.available).toBe(true);
  });

  it('never exposes the password hash or private document keys', async () => {
    const { token } = await signUpDriver();
    const res = await getMe(token).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/private\//);
  });

  it('401: no token', async () => {
    const res = await getMe().expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('401: token from a logged-out session', async () => {
    const { token } = await signUpPassenger();
    await ctx.http().post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
    const res = await getMe(token).expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('401: the account was deleted after the token was issued', async () => {
    const { token } = await signUpPassenger();
    await ctx.db.query('DELETE FROM users');
    const res = await getMe(token).expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});

// ------------------------------------------------------------------ updateMyProfile
describe('PATCH /api/users/me', () => {
  const patchMe = (token: string | undefined, body: object) => {
    const req = ctx.http().patch('/api/users/me');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  it('200: updates the full name and returns the updated profile', async () => {
    const { token, user } = await signUpPassenger();
    const res = await patchMe(token, { fullName: 'Jane Q. Doe' }).expect(200);

    expect(res.body).toEqual({
      success: true,
      message: 'Profile updated successfully',
      data: { ...user, fullName: 'Jane Q. Doe' },
    });
  });

  it('persists the change', async () => {
    const { token } = await signUpPassenger();
    await patchMe(token, { fullName: 'Jane Q. Doe' }).expect(200);
    const res = await ctx.http().get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.fullName).toBe('Jane Q. Doe');
  });

  it('200: Driver keeps their driverDetails', async () => {
    const { token, user } = await signUpDriver();
    const res = await patchMe(token, { fullName: 'Johnny Smith' }).expect(200);
    expect(res.body.data).toEqual({ ...user, fullName: 'Johnny Smith' });
  });

  it('trims the full name', async () => {
    const { token } = await signUpPassenger();
    const res = await patchMe(token, { fullName: '  Jane Q. Doe  ' }).expect(200);
    expect(res.body.data.fullName).toBe('Jane Q. Doe');
  });

  it('ignores fields that cannot be changed here (email, phone, role)', async () => {
    const { token, user } = await signUpPassenger();
    const res = await patchMe(token, {
      fullName: 'Jane Q. Doe',
      email: 'hacker@example.com',
      phone: '+19025550000',
      role: 'DRIVER',
    }).expect(200);
    expect(res.body.data).toEqual({ ...user, fullName: 'Jane Q. Doe' });
  });

  it('400: fullName is required', async () => {
    const { token } = await signUpPassenger();
    const res = await patchMe(token, {}).expect(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Request failed validation',
      error: {
        statusCode: 400,
        status: 'Bad Request',
        details: [{ field: 'fullName', message: 'Full name is required' }],
      },
    });
  });

  it.each([
    ['J', 'Full name must be between 2 and 100 characters'],
    ['x'.repeat(101), 'Full name must be between 2 and 100 characters'],
    ['   ', 'Full name is required'],
    [42, 'Full name must be text'],
  ])('400: fullName = %j', async (fullName, message) => {
    const { token } = await signUpPassenger();
    const res = await patchMe(token, { fullName }).expect(400);
    expect(res.body.error.details).toEqual([{ field: 'fullName', message }]);
  });

  it('does not change anything when validation fails', async () => {
    const { token } = await signUpPassenger();
    await patchMe(token, { fullName: 'J' }).expect(400);
    const [row] = await ctx.db.query('SELECT full_name FROM users');
    expect(row.full_name).toBe('Jane Doe');
  });

  it('401: no token', async () => {
    const res = await patchMe(undefined, { fullName: 'Jane Q. Doe' }).expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});

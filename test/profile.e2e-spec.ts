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

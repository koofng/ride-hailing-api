import {
  clearUploads,
  createTestApp,
  ISO_DATE,
  JPEG,
  listUploads,
  passengerBody,
  pathOf,
  PDF,
  PNG,
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

// ------------------------------------------------------------------ uploadMyPhoto
describe('PUT /api/users/me/photo', () => {
  const putPhoto = (
    token: string | undefined,
    photo?: { buffer: Buffer; filename: string; contentType: string },
  ) => {
    const req = ctx.http().put('/api/users/me/photo');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return photo
      ? req.attach('photo', photo.buffer, { filename: photo.filename, contentType: photo.contentType })
      : req;
  };
  const jpeg = { buffer: JPEG, filename: 'me.jpg', contentType: 'image/jpeg' };
  const png = { buffer: PNG, filename: 'me.png', contentType: 'image/png' };
  const photoPath = (url: string) => new URL(url).pathname;

  it('200: Passenger adds a first photo and gets the updated profile', async () => {
    const { token, user } = await signUpPassenger();
    expect(user.photoUrl).toBeNull();

    const res = await putPhoto(token, jpeg).expect(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Profile photo updated successfully',
      data: { ...user, photoUrl: expect.stringMatching(SIGNED_PHOTO_URL) },
    });
    expect(photoPath(res.body.data.photoUrl)).toMatch(/\.jpg$/);
  });

  it('serves the new photo through its signed link and persists it', async () => {
    const { token } = await signUpPassenger();
    const res = await putPhoto(token, png).expect(200);
    const { photoUrl } = res.body.data;

    await ctx.http().get(pathOf(photoUrl)).expect(200).expect('Content-Type', /image\/png/);
    const me = await ctx.http().get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(photoPath(me.body.data.photoUrl)).toBe(photoPath(photoUrl));
  });

  it('200: Driver replaces their photo; the old file is deleted', async () => {
    const { token, user } = await signUpDriver();
    await ctx.http().get(pathOf(user.photoUrl)).expect(200);

    const res = await putPhoto(token, jpeg).expect(200);
    expect(res.body.data).toEqual({ ...user, photoUrl: expect.stringMatching(SIGNED_PHOTO_URL) });
    expect(photoPath(res.body.data.photoUrl)).not.toBe(photoPath(user.photoUrl));

    await ctx.http().get(pathOf(user.photoUrl)).expect(403);
    expect(await listUploads('public')).toHaveLength(1);
  });

  it('leaves the private driver documents alone', async () => {
    const { token } = await signUpDriver();
    const before = await listUploads('private');
    await putPhoto(token, jpeg).expect(200);
    expect((await listUploads('private')).sort()).toEqual(before.sort());
  });

  it('400: photo is required', async () => {
    const { token } = await signUpPassenger();
    const res = await putPhoto(token).expect(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Request failed validation',
      error: {
        statusCode: 400,
        status: 'Bad Request',
        details: [{ field: 'photo', message: 'Profile photo is required' }],
      },
    });
  });

  it.each([
    ['a PDF', { buffer: PDF, filename: 'me.pdf', contentType: 'application/pdf' }],
    ['a script labelled as PNG', { buffer: Buffer.from('<?php evil(); ?>'), filename: 'me.png', contentType: 'image/png' }],
  ])('400: rejects %s', async (_label, photo) => {
    const { token } = await signUpPassenger();
    const res = await putPhoto(token, photo).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'photo', message: 'Profile photo must be a JPEG or PNG image' },
    ]);
  });

  it('400: file larger than 5 MB', async () => {
    const { token } = await signUpPassenger();
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await putPhoto(token, { ...jpeg, buffer: big }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'photo', message: 'File must be 5 MB or smaller' },
    ]);
  });

  it('413: rejects uploads far above the limit before buffering them', async () => {
    const { token } = await signUpPassenger();
    const huge = Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await putPhoto(token, { ...jpeg, buffer: huge }).expect(413);
    expect(res.body).toMatchObject({
      success: false,
      error: { statusCode: 413, status: 'Payload Too Large' },
    });
  });

  it('keeps the existing photo and writes no files when validation fails', async () => {
    const { token, user } = await signUpDriver();
    const before = await listUploads('public');
    await putPhoto(token, { buffer: PDF, filename: 'me.pdf', contentType: 'application/pdf' }).expect(400);

    expect(await listUploads('public')).toEqual(before);
    const me = await ctx.http().get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(photoPath(me.body.data.photoUrl)).toBe(photoPath(user.photoUrl));
  });

  it('401: no token, and nothing is written', async () => {
    const res = await putPhoto(undefined, jpeg).expect(401);
    expect(res.body).toEqual(UNAUTHORIZED);
    expect(await listUploads('public')).toHaveLength(0);
  });
});

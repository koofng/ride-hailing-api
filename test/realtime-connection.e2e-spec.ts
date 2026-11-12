import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io-client';
import {
  bearer,
  clearUploads,
  connectSocket,
  createTestApp,
  resetDatabase,
  signUpDriver,
  signUpPassenger,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
const open: Socket[] = [];

const connect = async (token?: string) => {
  const socket = await connectSocket(ctx.url, token);
  open.push(socket);
  return socket;
};

const disconnected = (socket: Socket, timeoutMs = 2000) =>
  new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('still connected')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });

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

describe('WebSocket connection', () => {
  it('connects with a valid token in auth.token', async () => {
    const passenger = await signUpPassenger(ctx);
    const socket = await connect(passenger.token);
    expect(socket.connected).toBe(true);
  });

  it('accepts the token with a "Bearer " prefix too', async () => {
    const driver = await signUpDriver(ctx);
    const socket = await connect(`Bearer ${driver.token}`);
    expect(socket.connected).toBe(true);
  });

  it.each([
    ['no token', undefined],
    ['a malformed token', 'not-a-jwt'],
    [
      'a token signed with another secret',
      jwt.sign({ sub: crypto.randomUUID(), role: 'PASSENGER', jti: crypto.randomUUID() }, 'x'.repeat(40), {
        expiresIn: 600,
      }),
    ],
  ])('refuses %s', async (_label, token) => {
    await expect(connect(token)).rejects.toThrow('Missing or expired access token');
  });

  it('refuses an expired token', async () => {
    const passenger = await signUpPassenger(ctx);
    const expired = jwt.sign(
      {
        sub: passenger.user.id,
        role: 'PASSENGER',
        jti: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      process.env.JWT_SECRET!,
    );
    await expect(connect(expired)).rejects.toThrow('Missing or expired access token');
  });

  it('refuses a token that was logged out', async () => {
    const passenger = await signUpPassenger(ctx);
    await ctx.http().post('/api/auth/logout').set(bearer(passenger.token)).expect(200);
    await expect(connect(passenger.token)).rejects.toThrow('Missing or expired access token');
  });

  it('logging out closes the sockets that used that token, and only those', async () => {
    const passenger = await signUpPassenger(ctx);
    const [{ email }] = await ctx.db.query('SELECT email FROM users');
    const second = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email, password: 'correct-horse' })
      .expect(200);
    const phone = await connect(passenger.token);
    const tablet = await connect(second.body.data.accessToken);

    const closed = disconnected(phone);
    await ctx.http().post('/api/auth/logout').set(bearer(passenger.token)).expect(200);
    expect(await closed).toBe('io server disconnect');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tablet.connected).toBe(true);
  });

  it('closes the connection when its token expires', async () => {
    const passenger = await signUpPassenger(ctx);
    const shortLived = jwt.sign(
      { sub: passenger.user.id, role: 'PASSENGER', jti: crypto.randomUUID() },
      process.env.JWT_SECRET!,
      { expiresIn: 2 },
    );
    const socket = await connect(shortLived);
    expect(await disconnected(socket, 4000)).toBe('io server disconnect');
  }, 10_000);
});

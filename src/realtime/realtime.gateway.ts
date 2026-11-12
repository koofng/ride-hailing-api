import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService, type AuthUser } from '../auth/token.service.js';
import { Role } from '../users/role.enum.js';

export const DRIVERS_ROOM = 'drivers';
export const userRoom = (userId: string) => `user:${userId}`;
const tokenRoom = (jti: string) => `token:${jti}`;

/** setTimeout cannot wait longer than this (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export type AuthedSocket = Socket & { data: { user: AuthUser } };

/** The token from `auth: { token }` (preferred) or an `Authorization: Bearer` header. */
function tokenFrom(socket: Socket): string | null {
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const raw =
    typeof fromAuth === 'string' ? fromAuth : (socket.handshake.headers.authorization ?? '');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

/**
 * Socket.IO endpoint for the spec's real-time events, on the same host and
 * port as the REST API (path /socket.io). Clients connect with the same JWT
 * they use for REST. Each socket joins a room for its user (and Drivers the
 * drivers room), so events can be sent to a person on every device they use.
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() private server!: Server;

  constructor(private readonly tokens: TokenService) {}

  afterInit(server: Server): void {
    // Checked before the connection is accepted: a socket without a valid,
    // unrevoked token never connects and never joins a room.
    server.use((socket, next) => {
      const token = tokenFrom(socket);
      (token ? this.tokens.verify(token) : Promise.resolve(null))
        .then((user) => {
          if (!user) return next(new Error('Missing or expired access token'));
          (socket as AuthedSocket).data.user = user;
          next();
        })
        .catch((error: unknown) => {
          this.logger.error(`Socket authentication failed: ${String(error)}`);
          next(new Error('Something went wrong. Please try again.'));
        });
    });

    // Logging out closes the WebSocket connections that used that token.
    this.tokens.onRevoked((jti) => server.in(tokenRoom(jti)).disconnectSockets(true));
  }

  handleConnection(socket: AuthedSocket): void {
    const { user } = socket.data;
    void socket.join([
      userRoom(user.id),
      tokenRoom(user.jti),
      ...(user.role === Role.DRIVER ? [DRIVERS_ROOM] : []),
    ]);

    // The connection lasts no longer than its token.
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(user.expiresAt.getTime() - Date.now(), 0), MAX_TIMEOUT_MS),
    );
    socket.once('disconnect', () => clearTimeout(timer));
  }

  /** Sends an event to every connected device of one user. */
  toUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /** Sends an event to every connected Driver, optionally leaving one out. */
  toDrivers(event: string, payload: unknown, exceptUserId?: string): void {
    const target = this.server.to(DRIVERS_ROOM);
    (exceptUserId ? target.except(userRoom(exceptUserId)) : target).emit(event, payload);
  }
}

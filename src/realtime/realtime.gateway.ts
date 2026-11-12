import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { TokenService, type AuthUser } from '../auth/token.service.js';
import { ApiValidationException } from '../common/errors/api-validation.exception.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { toFieldErrors } from '../common/validation/to-field-errors.js';
import { Role } from '../users/role.enum.js';
import { DriverLocationRelay } from './driver-location.relay.js';
import { DriverLocationDto } from './dto/driver-location.dto.js';

export const DRIVERS_ROOM = 'drivers';
export const userRoom = (userId: string) => `user:${userId}`;
const tokenRoom = (jti: string) => `token:${jti}`;

/** Location updates closer together than this (per socket) are ignored. */
export const LOCATION_MIN_INTERVAL_MS = 1000;

/** setTimeout cannot wait longer than this (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export type AuthedSocket = Socket & { data: { user: AuthUser; lastLocationAt?: number } };

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
// Global (APP_FILTER) filters do not apply to gateways, so opt in here: errors
// reach the socket as an "exception" event in the same envelope as REST.
@UseFilters(AllExceptionsFilter)
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly locations: DriverLocationRelay,
  ) {}

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

  /**
   * driver:location from the Driver app: stores the position and, during a
   * trip, forwards it to the Passenger with an ETA. The acknowledgement says
   * whether the update was used; more than one per second is ignored.
   */
  @SubscribeMessage('driver:location')
  @Roles(Role.DRIVER)
  @ResponseMessage((data: { accepted: boolean }) =>
    data.accepted ? 'Location updated' : 'Ignored: send at most one location per second',
  )
  async onDriverLocation(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<{ accepted: boolean }> {
    const location = plainToInstance(DriverLocationDto, body ?? {});
    const errors = toFieldErrors(await validate(location, { whitelist: true }));
    if (errors.length) throw new ApiValidationException(errors);

    const now = Date.now();
    if (socket.data.lastLocationAt && now - socket.data.lastLocationAt < LOCATION_MIN_INTERVAL_MS) {
      return { accepted: false };
    }
    socket.data.lastLocationAt = now;

    const forward = await this.locations.update(socket.data.user.id, location);
    if (forward) this.toUser(forward.passengerId, 'driver:location', forward.event);
    return { accepted: true };
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

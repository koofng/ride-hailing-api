import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { TokenService, type AuthUser } from './token.service.js';

export type AuthenticatedRequest = Request & { user: AuthUser };

/**
 * The authenticated caller of an HTTP request or a WebSocket message. Sockets
 * are authenticated once, when they connect (see RealtimeGateway).
 */
export function userFromContext(context: ExecutionContext): AuthUser | undefined {
  if (context.getType() === 'ws') {
    return (context.switchToWs().getClient<Socket>().data as { user?: AuthUser }).user;
  }
  return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
}

/**
 * Global guard: every endpoint requires `Authorization: Bearer <token>`
 * unless marked @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // A socket is only kept open after its token was verified on connect.
    if (context.getType() === 'ws') return userFromContext(context) !== undefined;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const user =
      scheme?.toLowerCase() === 'bearer' && token ? await this.tokens.verify(token) : null;
    if (!user) {
      throw new UnauthorizedException('Missing or expired access token');
    }
    request.user = user;
    return true;
  }
}

/** Injects the authenticated caller set by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => userFromContext(context)!,
);

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import type { Role } from '../users/role.enum.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

export const ROLE_FORBIDDEN = 'Your account role is not allowed to perform this action';

/**
 * Global guard, registered after JwtAuthGuard: enforces @Roles() using the
 * role in the verified token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(ROLE_FORBIDDEN);
    }
    return true;
  }
}

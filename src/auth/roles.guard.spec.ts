import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { RolesGuard } from './roles.guard.js';

class Handlers {
  @Roles(Role.PASSENGER)
  passengerOnly() {}

  @Roles(Role.PASSENGER, Role.DRIVER)
  either() {}

  open() {}
}

const contextFor = (handler: keyof Handlers, role?: Role): ExecutionContext =>
  ({
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { id: 'u1', role, jti: 'j', expiresAt: new Date() } : undefined }),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a matching role', () => {
    expect(guard.canActivate(contextFor('passengerOnly', Role.PASSENGER))).toBe(true);
  });

  it('rejects any other role with the spec message', () => {
    expect(() => guard.canActivate(contextFor('passengerOnly', Role.DRIVER))).toThrow(
      new ForbiddenException('Your account role is not allowed to perform this action'),
    );
  });

  it('allows every listed role', () => {
    expect(guard.canActivate(contextFor('either', Role.DRIVER))).toBe(true);
    expect(guard.canActivate(contextFor('either', Role.PASSENGER))).toBe(true);
  });

  it('allows any signed-in user when no roles are set', () => {
    expect(guard.canActivate(contextFor('open', Role.DRIVER))).toBe(true);
  });

  it('rejects a restricted endpoint when there is no user on the request', () => {
    expect(() => guard.canActivate(contextFor('passengerOnly'))).toThrow(ForbiddenException);
  });
});

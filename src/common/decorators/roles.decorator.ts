import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../users/role.enum.js';

export const ROLES_KEY = 'roles';

/** Restricts an endpoint to the given roles. Endpoints without it allow any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

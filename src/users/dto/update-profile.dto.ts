import { IsFullName } from './full-name.validator.js';

/**
 * Spec: `UpdateProfileRequest`. Only the full name can be changed here; any
 * other field (email, phone, role, ...) is stripped by the global ValidationPipe.
 */
export class UpdateProfileDto {
  @IsFullName()
  fullName: string;
}

import type { ValidationError } from 'class-validator';
import type { FieldError } from '../errors/api-validation.exception.js';

/**
 * Constraints that describe a more basic problem than the others, so their
 * message wins when several fail on one field. For a missing email we want
 * "Email is required", not "Must be a valid email address"; for `page=abc`,
 * "must be a whole number", not "must be 0 or more".
 */
const PRIORITY = ['isDefined', 'isNotEmpty', 'isString', 'isNumber', 'isInt'];

/** Turns class-validator output into one `{ field, message }` per field. */
export function toFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const constraints = error.constraints ?? {};
    const keys = Object.keys(constraints);
    if (keys.length > 0) {
      const key = PRIORITY.find((k) => k in constraints) ?? keys[0];
      result.push({ field, message: constraints[key] });
    }
    if (error.children?.length) {
      result.push(...toFieldErrors(error.children, field));
    }
  }
  return result;
}

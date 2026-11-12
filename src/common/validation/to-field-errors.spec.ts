import type { ValidationError } from 'class-validator';
import { toFieldErrors } from './to-field-errors.js';

const err = (property: string, constraints: Record<string, string>, children: ValidationError[] = []) =>
  ({ property, constraints, children }) as ValidationError;

describe('toFieldErrors', () => {
  it('returns one entry per field', () => {
    expect(
      toFieldErrors([
        err('email', { isEmail: 'Must be a valid email address' }),
        err('password', { minLength: 'Password must be at least 8 characters' }),
      ]),
    ).toEqual([
      { field: 'email', message: 'Must be a valid email address' },
      { field: 'password', message: 'Password must be at least 8 characters' },
    ]);
  });

  it('prefers the "required" message when a field is missing', () => {
    expect(
      toFieldErrors([
        err('email', {
          isEmail: 'Must be a valid email address',
          isString: 'Must be a valid email address',
          isNotEmpty: 'Email is required',
        }),
      ]),
    ).toEqual([{ field: 'email', message: 'Email is required' }]);
  });

  it('prefers the type message over range messages', () => {
    expect(
      toFieldErrors([
        err('page', { min: 'Page must be 0 or more', isInt: 'Page must be a whole number' }),
      ]),
    ).toEqual([{ field: 'page', message: 'Page must be a whole number' }]);
  });

  it('uses dotted paths for nested fields', () => {
    expect(
      toFieldErrors([err('origin', {}, [err('lat', { max: 'Latitude must be at most 90' })])]),
    ).toEqual([{ field: 'origin.lat', message: 'Latitude must be at most 90' }]);
  });
});

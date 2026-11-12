import { QueryFailedError } from 'typeorm';

/** True if a query failed because it broke the named database constraint. */
export function violatesConstraint(error: unknown, constraint: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { constraint?: string } | undefined)?.constraint === constraint
  );
}

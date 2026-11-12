import type { FieldError } from '../errors/api-validation.exception.js';

/** Spec: `ErrorDetail`, the `error` field of a failed response. */
export interface ErrorDetail {
  statusCode: number;
  /** HTTP status name, e.g. `Bad Request` */
  status: string;
  details?: FieldError[];
}

/** Every successful response: `{ success: true, message, data }`. */
export interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

/** Every error response: `{ success: false, message, error }`. */
export interface ErrorResponse {
  success: false;
  message: string;
  error: ErrorDetail;
}

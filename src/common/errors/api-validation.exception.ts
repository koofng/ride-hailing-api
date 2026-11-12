import { BadRequestException } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * 400 response carrying field-level `details`, as in the spec's `Error` schema.
 */
export class ApiValidationException extends BadRequestException {
  constructor(details: FieldError[], message = 'Request failed validation') {
    super({ message, details });
  }
}

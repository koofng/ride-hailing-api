import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * The spec's `fullName` rules (2-100 characters, trimmed), shared by
 * registration and profile update so both give the same messages.
 */
export const IsFullName = () =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    IsNotEmpty({ message: 'Full name is required' }),
    IsString({ message: 'Full name must be text' }),
    Length(2, 100, { message: 'Full name must be between 2 and 100 characters' }),
  );

import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsFullName } from '../../users/dto/full-name.validator.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

const trimLower = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** E.164: "+" then up to 15 digits, e.g. +19025551234 */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Spec: `PassengerRegistrationRequest`. Also the shared part of Driver registration. */
export class PassengerRegistrationDto {
  @IsFullName()
  fullName: string;

  @trimLower()
  @IsNotEmpty({ message: 'Email is required' })
  @IsString({ message: 'Must be a valid email address' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;

  @trim()
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString({ message: 'Phone number must be text' })
  @Matches(E164, {
    message: 'Must be a valid phone number in international format, e.g. +19025551234',
  })
  phone: string;

  // Not trimmed: spaces are legitimate password characters.
  @IsNotEmpty({ message: 'Password is required' })
  @IsString({ message: 'Password must be text' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}

/**
 * Text fields of spec `DriverRegistrationRequest`. The three files are
 * validated separately in DriverRegistrationValidator.
 */
export class DriverRegistrationFieldsDto extends PassengerRegistrationDto {
  @trim()
  @IsNotEmpty({ message: 'Licence number is required' })
  @IsString({ message: 'Licence number must be text' })
  @MaxLength(50, { message: 'Licence number must be at most 50 characters' })
  licenceNumber: string;

  @trim()
  @IsNotEmpty({ message: 'Vehicle make is required' })
  @IsString({ message: 'Vehicle make must be text' })
  @MaxLength(50, { message: 'Vehicle make must be at most 50 characters' })
  vehicleMake: string;

  @trim()
  @IsNotEmpty({ message: 'Vehicle model is required' })
  @IsString({ message: 'Vehicle model must be text' })
  @MaxLength(50, { message: 'Vehicle model must be at most 50 characters' })
  vehicleModel: string;

  @trim()
  @IsNotEmpty({ message: 'Vehicle colour is required' })
  @IsString({ message: 'Vehicle colour must be text' })
  @MaxLength(30, { message: 'Vehicle colour must be at most 30 characters' })
  vehicleColour: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : value,
  )
  @IsNotEmpty({ message: 'Plate number is required' })
  @IsString({ message: 'Plate number must be text' })
  @MaxLength(15, { message: 'Plate number must be at most 15 characters' })
  plateNumber: string;
}

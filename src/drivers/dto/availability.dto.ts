import {
  IsBoolean,
  IsDefined,
  IsLatitude,
  IsLongitude,
  IsNumber,
  ValidateIf,
} from 'class-validator';

/**
 * Spec: `AvailabilityRequest`. Going online also needs the Driver's current
 * position (until live location arrives over WebSockets), so they can appear
 * on Passengers' maps straight away.
 */
export class AvailabilityDto {
  @IsDefined({ message: 'Available is required' })
  @IsBoolean({ message: 'Available must be true or false' })
  available: boolean;

  @ValidateIf((o: AvailabilityDto) => o.available === true)
  @IsDefined({ message: 'Latitude is required to go online' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Latitude must be a number' })
  @IsLatitude({ message: 'Latitude must be between -90 and 90' })
  lat?: number;

  @ValidateIf((o: AvailabilityDto) => o.available === true)
  @IsDefined({ message: 'Longitude is required to go online' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Longitude must be a number' })
  @IsLongitude({ message: 'Longitude must be between -180 and 180' })
  lng?: number;
}

import { IsDefined, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Spec: `DriverLocationUpdate`, sent by the Driver app as `driver:location`. */
export class DriverLocationDto {
  @IsDefined({ message: 'Latitude is required' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Latitude must be a number' })
  @IsLatitude({ message: 'Latitude must be between -90 and 90' })
  lat: number;

  @IsDefined({ message: 'Longitude is required' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Longitude must be a number' })
  @IsLongitude({ message: 'Longitude must be between -180 and 180' })
  lng: number;

  /** Direction of travel in degrees, for rotating the car icon. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Heading must be a number' })
  @Min(0, { message: 'Heading must be between 0 and 360' })
  @Max(360, { message: 'Heading must be between 0 and 360' })
  heading?: number;
}

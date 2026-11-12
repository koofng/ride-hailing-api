import { Type } from 'class-transformer';
import { IsDefined, IsLatitude, IsLongitude, IsNumber } from 'class-validator';

/** The Driver's current position, until live location arrives over WebSockets. */
export class NearbyQuery {
  @IsDefined({ message: 'Latitude is required' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Latitude must be a number' })
  @IsLatitude({ message: 'Latitude must be between -90 and 90' })
  lat: number;

  @IsDefined({ message: 'Longitude is required' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Longitude must be a number' })
  @IsLongitude({ message: 'Longitude must be between -180 and 180' })
  lng: number;
}

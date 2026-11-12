import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Spec: `Place` */
export class PlaceDto {
  @IsDefined({ message: 'Latitude is required' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Latitude must be a number' })
  @IsLatitude({ message: 'Latitude must be between -90 and 90' })
  lat: number;

  @IsDefined({ message: 'Longitude is required' })
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Longitude must be a number' })
  @IsLongitude({ message: 'Longitude must be between -180 and 180' })
  lng: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString({ message: 'Address must be text' })
  @MaxLength(255, { message: 'Address must be at most 255 characters' })
  address?: string;
}

/** Spec: `CreateTripRequest` */
export class CreateTripDto {
  @IsDefined({ message: 'Pickup location is required' })
  @IsObject({ message: 'Pickup location must be an object with lat and lng' })
  @ValidateNested()
  @Type(() => PlaceDto)
  origin: PlaceDto;

  @IsDefined({ message: 'Destination is required' })
  @IsObject({ message: 'Destination must be an object with lat and lng' })
  @ValidateNested()
  @Type(() => PlaceDto)
  destination: PlaceDto;
}

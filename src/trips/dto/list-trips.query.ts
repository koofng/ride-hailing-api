import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TripStatus } from '../trip.enums.js';

/** Accepts `status=A,B` (spec: style form, explode false) and `status=A&status=B`. */
const toList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
    .filter((v) => v !== '');

/** Query parameters of `listTrips`. */
export class ListTripsQuery {
  @IsOptional()
  @Transform(toList)
  @IsEnum(TripStatus, {
    each: true,
    message: `Status must be one of: ${Object.values(TripStatus).join(', ')}`,
  })
  status?: TripStatus[];

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(0, { message: 'Page must be 0 or more' })
  page = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Size must be a whole number' })
  @Min(1, { message: 'Size must be between 1 and 100' })
  @Max(100, { message: 'Size must be between 1 and 100' })
  size = 20;
}

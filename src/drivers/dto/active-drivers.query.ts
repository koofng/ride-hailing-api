import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { NearbyQuery } from '../../trips/dto/nearby.query.js';

/** Query parameters of `listActiveDrivers`: the map centre and search radius. */
export class ActiveDriversQuery extends NearbyQuery {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'Radius must be a number' })
  @Min(0.1, { message: 'Radius must be between 0.1 and 20 km' })
  @Max(20, { message: 'Radius must be between 0.1 and 20 km' })
  radiusKm = 5;
}

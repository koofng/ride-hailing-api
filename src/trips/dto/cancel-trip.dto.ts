import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PassengerCancelReason } from '../trip.enums.js';

/** Body of `cancelTrip`: why the Passenger is cancelling. */
export class CancelTripDto {
  @IsDefined({ message: 'Cancellation reason is required' })
  @IsEnum(PassengerCancelReason, {
    message: `Cancellation reason must be one of: ${Object.values(PassengerCancelReason).join(', ')}`,
  })
  reason: PassengerCancelReason;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString({ message: 'Note must be text' })
  @MaxLength(500, { message: 'Note must be at most 500 characters' })
  note?: string;
}

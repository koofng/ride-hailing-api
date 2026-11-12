import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Spec: `LogoutRequest` (the body is optional). */
export class LogoutDto {
  @IsOptional()
  @IsString({ message: 'Device token must be text' })
  @MaxLength(4096, { message: 'Device token is too long' })
  deviceToken?: string;
}

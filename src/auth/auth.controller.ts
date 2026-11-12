import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Public } from '../common/decorators/public.decorator.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { AuthService } from './auth.service.js';
import type { AuthResponse } from './dto/auth-response.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { PassengerRegistrationDto } from './dto/registration.dto.js';
import { MAX_UPLOAD_BYTES } from '../storage/upload-validation.js';
import { validateDriverRegistration, type DriverUploads } from './driver-registration.validator.js';
import { CurrentUser } from './jwt-auth.guard.js';
import type { AuthUser } from './token.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** operationId: registerPassenger */
  @Public()
  @Post('register/passenger')
  @ResponseMessage('Passenger registered successfully')
  registerPassenger(@Body() dto: PassengerRegistrationDto): Promise<AuthResponse> {
    return this.auth.registerPassenger(dto);
  }

  /** operationId: registerDriver (multipart/form-data) */
  @Public()
  @Post('register/driver')
  @ResponseMessage('Driver registered successfully')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'licenceImage', maxCount: 1 },
        { name: 'insuranceDocument', maxCount: 1 },
        { name: 'photo', maxCount: 1 },
      ],
      {
        // No `storage`/`dest`: files stay in memory until validated.
        // The 5 MB rule is checked in the validator so it is reported as a
        // field error (400). This is only a hard cap against huge uploads,
        // which get 413 Payload Too Large.
        limits: { fileSize: 2 * MAX_UPLOAD_BYTES, files: 3, fields: 20 },
      },
    ),
  )
  async registerDriver(
    // Typed as a plain object so the global ValidationPipe skips it: the text
    // fields and the files are validated together in one step.
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: DriverUploads,
  ): Promise<AuthResponse> {
    return this.auth.registerDriver(await validateDriverRegistration(body, files));
  }

  /** operationId: login */
  @Public()
  @Post('login')
  @ResponseMessage('Logged in successfully')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  /** operationId: logout */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged out successfully')
  async logout(@CurrentUser() caller: AuthUser, @Body() _dto: LogoutDto): Promise<void> {
    await this.auth.logout(caller);
  }
}

import {
  Body,
  Controller,
  Get,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { MAX_UPLOAD_BYTES } from '../storage/upload-validation.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfileService } from './profile.service.js';
import type { UserProfileResponse } from './user-profile.js';

@Controller('users')
export class UsersController {
  constructor(private readonly profile: ProfileService) {}

  /** operationId: getMyProfile */
  @Get('me')
  @ResponseMessage('Profile retrieved successfully')
  getMyProfile(@CurrentUser() caller: AuthUser): Promise<UserProfileResponse> {
    return this.profile.getProfile(caller.id);
  }

  /** operationId: updateMyProfile */
  @Patch('me')
  @ResponseMessage('Profile updated successfully')
  updateMyProfile(
    @CurrentUser() caller: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponse> {
    return this.profile.updateProfile(caller.id, dto);
  }

  /** operationId: uploadMyPhoto (multipart/form-data) */
  @Put('me/photo')
  @ResponseMessage('Profile photo updated successfully')
  @UseInterceptors(
    FileInterceptor('photo', {
      // Kept in memory until validated. The 5 MB rule is reported as a field
      // error (400); this cap only stops huge uploads early (413).
      limits: { fileSize: 2 * MAX_UPLOAD_BYTES, files: 1, fields: 5 },
    }),
  )
  uploadMyPhoto(
    @CurrentUser() caller: AuthUser,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ): Promise<UserProfileResponse> {
    return this.profile.updatePhoto(caller.id, photo);
  }
}

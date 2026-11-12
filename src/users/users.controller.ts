import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
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
}

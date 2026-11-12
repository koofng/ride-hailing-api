import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiValidationException } from '../common/errors/api-validation.exception.js';
import { StorageService } from '../storage/storage.service.js';
import { checkUpload, IMAGE_TYPES, type UploadRule } from '../storage/upload-validation.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { User } from './entities/user.entity.js';
import { toUserProfile, type UserProfileResponse } from './user-profile.js';
import { UsersService } from './users.service.js';

const PHOTO_RULE: UploadRule = {
  required: 'Profile photo is required',
  types: IMAGE_TYPES,
  wrongType: 'Profile photo must be a JPEG or PNG image',
};

/** The signed-in user's own profile (spec tag: Profile). */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly users: UsersService,
    private readonly storage: StorageService,
  ) {}

  async getProfile(userId: string): Promise<UserProfileResponse> {
    return toUserProfile(await this.loadUser(userId));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileResponse> {
    const user = await this.loadUser(userId);
    await this.users.updateFullName(user.id, dto.fullName);
    user.fullName = dto.fullName;
    return toUserProfile(user);
  }

  /**
   * Saves the new photo, points the profile at it, then deletes the old one.
   * If the database update fails, the new file is removed again.
   */
  async updatePhoto(
    userId: string,
    upload: Express.Multer.File | undefined,
  ): Promise<UserProfileResponse> {
    const result = checkUpload(upload, PHOTO_RULE);
    if (!result.ok) {
      throw new ApiValidationException([{ field: 'photo', message: result.message }]);
    }

    const user = await this.loadUser(userId);
    const oldPhotoUrl = user.photoUrl;

    const key = await this.storage.save(result.file.buffer, result.file.type, 'public', 'photos');
    const photoUrl = this.storage.publicUrl(key);
    try {
      await this.users.updatePhotoUrl(user.id, photoUrl);
    } catch (error) {
      await this.storage.remove([key]);
      throw error;
    }
    user.photoUrl = photoUrl;

    await this.removeOldPhoto(oldPhotoUrl);
    return toUserProfile(user);
  }

  /** The new photo is already saved, so a failed cleanup must not fail the request. */
  private async removeOldPhoto(photoUrl: string | null): Promise<void> {
    const key = photoUrl ? this.storage.keyFromPublicUrl(photoUrl) : null;
    if (!key) return;
    try {
      await this.storage.remove([key]);
    } catch (error) {
      this.logger.warn(`Could not delete old profile photo ${key}: ${String(error)}`);
    }
  }

  /**
   * The token is valid but its account may have been deleted since it was
   * issued. Treat that like an invalid token rather than a 404.
   */
  private async loadUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Missing or expired access token');
    }
    return user;
  }
}

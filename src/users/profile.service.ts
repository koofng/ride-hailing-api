import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from './entities/user.entity.js';
import { toUserProfile, type UserProfileResponse } from './user-profile.js';
import { UsersService } from './users.service.js';

/** The signed-in user's own profile (spec tag: Profile). */
@Injectable()
export class ProfileService {
  constructor(private readonly users: UsersService) {}

  async getProfile(userId: string): Promise<UserProfileResponse> {
    return toUserProfile(await this.loadUser(userId));
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

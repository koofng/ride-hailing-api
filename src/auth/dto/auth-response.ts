import type { UserProfileResponse } from '../../users/user-profile.js';

/** Spec: `AuthResponse` */
export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserProfileResponse;
}

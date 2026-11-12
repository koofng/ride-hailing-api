import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { QueryFailedError } from 'typeorm';
import type { AppEnv } from '../config/env.validation.js';
import { StorageService } from '../storage/storage.service.js';
import type { User } from '../users/entities/user.entity.js';
import { Role } from '../users/role.enum.js';
import { toUserProfile } from '../users/user-profile.js';
import { UsersService } from '../users/users.service.js';
import type { AuthResponse } from './dto/auth-response.js';
import type { LoginDto } from './dto/login.dto.js';
import type { PassengerRegistrationDto } from './dto/registration.dto.js';
import type { ValidDriverRegistration } from './driver-registration.validator.js';
import { TokenService, type AuthUser } from './token.service.js';

const PASSENGER_CONFLICT = 'An account with this email or phone number already exists';
const DRIVER_CONFLICT =
  'An account with this email, phone number or plate number already exists';
const BAD_CREDENTIALS = 'Incorrect email or password';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly bcryptRounds: number;
  /** Compared against when the email is unknown, so both cases take equal time. */
  private dummyHash: string;

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly storage: StorageService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.bcryptRounds = config.get('BCRYPT_ROUNDS', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash('not-a-real-password', this.bcryptRounds);
  }

  async registerPassenger(dto: PassengerRegistrationDto): Promise<AuthResponse> {
    if (await this.users.isEmailOrPhoneTaken(dto.email, dto.phone)) {
      throw new ConflictException(PASSENGER_CONFLICT);
    }
    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const user = await this.withConflictMessage(PASSENGER_CONFLICT, () =>
      this.users.createPassenger({
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
      }),
    );
    return this.authResponse(user);
  }

  async registerDriver({ fields, files }: ValidDriverRegistration): Promise<AuthResponse> {
    const [accountTaken, plateTaken] = await Promise.all([
      this.users.isEmailOrPhoneTaken(fields.email, fields.phone),
      this.users.isPlateTaken(fields.plateNumber),
    ]);
    if (accountTaken || plateTaken) {
      throw new ConflictException(DRIVER_CONFLICT);
    }

    const passwordHash = await bcrypt.hash(fields.password, this.bcryptRounds);

    // Files are written only after validation and the duplicate check pass,
    // and removed again if creating the account fails.
    const keys: string[] = [];
    try {
      const licenceImageKey = await this.storage.save(
        files.licenceImage.buffer, files.licenceImage.type, 'private', 'driver-documents',
      );
      keys.push(licenceImageKey);
      const insuranceDocumentKey = await this.storage.save(
        files.insuranceDocument.buffer, files.insuranceDocument.type, 'private', 'driver-documents',
      );
      keys.push(insuranceDocumentKey);
      const photoKey = await this.storage.save(
        files.photo.buffer, files.photo.type, 'public', 'photos',
      );
      keys.push(photoKey);

      const user = await this.withConflictMessage(DRIVER_CONFLICT, () =>
        this.users.createDriver(
          {
            fullName: fields.fullName,
            email: fields.email,
            phone: fields.phone,
            passwordHash,
            photoKey,
          },
          {
            licenceNumber: fields.licenceNumber,
            licenceImageKey,
            insuranceDocumentKey,
            vehicleMake: fields.vehicleMake,
            vehicleModel: fields.vehicleModel,
            vehicleColour: fields.vehicleColour,
            plateNumber: fields.plateNumber,
          },
        ),
      );
      return this.authResponse(user);
    } catch (error) {
      await this.storage.remove(keys);
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    return this.authResponse(user);
  }

  /**
   * Revokes the current token and, for Drivers, goes offline.
   * The `deviceToken` from the request body is accepted but there is nothing to
   * remove yet: push tokens are not registered until push notifications are built.
   */
  async logout(caller: AuthUser): Promise<void> {
    await this.tokens.revoke(caller);
    if (caller.role === Role.DRIVER) {
      await this.users.setDriverAvailability(caller.id, false);
    }
  }

  private async authResponse(user: User): Promise<AuthResponse> {
    return {
      accessToken: await this.tokens.issue(user.id, user.role),
      tokenType: 'Bearer',
      expiresIn: this.tokens.expiresInSeconds,
      user: toUserProfile(user, (key) => this.storage.signedPhotoUrl(key)),
    };
  }

  /**
   * The duplicate check above can race with a concurrent registration; the
   * database unique constraints catch that case, and it gets the same 409.
   */
  private async withConflictMessage<T>(message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }
}

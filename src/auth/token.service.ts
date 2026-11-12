import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';
import type { AppEnv } from '../config/env.validation.js';
import type { Role } from '../users/role.enum.js';
import { RevokedToken } from './entities/revoked-token.entity.js';

export interface JwtPayload {
  sub: string;
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}

/** What the guard attaches to `request.user`. */
export interface AuthUser {
  id: string;
  role: Role;
  jti: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  readonly expiresInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<AppEnv, true>,
    @InjectRepository(RevokedToken) private readonly revoked: Repository<RevokedToken>,
  ) {
    this.expiresInSeconds = config.get('JWT_EXPIRES_IN_SECONDS', { infer: true });
  }

  issue(userId: string, role: Role): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, role },
      { jwtid: randomUUID(), expiresIn: this.expiresInSeconds },
    );
  }

  /** Returns the caller, or null if the token is invalid, expired or revoked. */
  async verify(token: string): Promise<AuthUser | null> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
    if (!payload.sub || !payload.role || !payload.jti || !payload.exp) return null;
    if (await this.revoked.exists({ where: { jti: payload.jti } })) return null;
    return {
      id: payload.sub,
      role: payload.role,
      jti: payload.jti,
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  async revoke(user: AuthUser): Promise<void> {
    await this.revoked
      .createQueryBuilder()
      .insert()
      .values({ jti: user.jti, userId: user.id, expiresAt: user.expiresAt })
      .orIgnore()
      .execute();
    // Rows for tokens that have expired anyway are no longer needed.
    await this.revoked.delete({ expiresAt: LessThan(new Date()) });
  }
}

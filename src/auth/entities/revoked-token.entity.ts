import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * JWT IDs invalidated by logout. A row only needs to live until the token
 * would have expired anyway; expired rows are pruned on logout.
 */
@Entity({ name: 'revoked_tokens' })
export class RevokedToken {
  @PrimaryColumn({ type: 'uuid' })
  jti: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Index('IDX_revoked_tokens_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}

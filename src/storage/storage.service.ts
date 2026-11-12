import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../config/env.validation.js';
import type { AllowedMimeType } from './file-type.js';
import { FILE_STORE, type FileStore, type StoredFile } from './file-store.js';

export type { StoredFile } from './file-store.js';

/**
 * Nothing in storage is served as a static file.
 * - `public`: may be shared through a signed, expiring link (profile photos).
 * - `private`: never leaves the server (driver licence and insurance documents).
 */
export type Visibility = 'public' | 'private';

const EXTENSIONS: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

const PHOTO_FOLDER = 'public/photos';
const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

/**
 * Uploaded files: storage keys, visibility and signed photo links. The bytes
 * themselves go to the configured FileStore (see StorageModule).
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly publicBaseUrl: string;
  private readonly linkTtlSeconds: number;
  private readonly signingKey: Buffer;

  constructor(
    config: ConfigService<AppEnv, true>,
    @Inject(FILE_STORE) private readonly store: FileStore,
  ) {
    this.publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
    this.linkTtlSeconds = config.get('FILE_URL_TTL_SECONDS', { infer: true });
    // Derived from JWT_SECRET with its own label, so a file signature can
    // never be confused with a token signature.
    this.signingKey = createHmac('sha256', config.get('JWT_SECRET', { infer: true }))
      .update('file-urls')
      .digest();
  }

  onModuleInit(): Promise<void> {
    return this.store.init();
  }

  onModuleDestroy(): Promise<void> {
    return this.store.close();
  }

  /** Saves a file and returns its storage key, e.g. `public/photos/<uuid>.jpg`. */
  async save(
    buffer: Buffer,
    mimeType: AllowedMimeType,
    visibility: Visibility,
    folder: string,
  ): Promise<string> {
    const key = `${visibility}/${folder}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
    await this.store.put(key, buffer, mimeType);
    return key;
  }

  /**
   * A link to a profile photo that works without a token until it expires.
   * The expiry is rounded up to a window boundary, so repeated calls within
   * one window return the same URL and clients can cache the image.
   */
  signedPhotoUrl(key: string, now = Date.now()): string {
    const name = key.startsWith(`${PHOTO_FOLDER}/`) ? key.slice(PHOTO_FOLDER.length + 1) : '';
    if (!PHOTO_NAME.test(name)) {
      throw new Error(`Not a profile photo key: ${key}`);
    }
    const ttl = this.linkTtlSeconds;
    const expires = (Math.floor(now / 1000 / ttl) + 2) * ttl;
    const sig = this.sign(name, expires);
    return `${this.publicBaseUrl}/api/files/photos/${name}?expires=${expires}&sig=${sig}`;
  }

  /** Opens a profile photo if the link is genuine and unexpired; otherwise null. */
  async openSignedPhoto(
    name: string,
    expires: unknown,
    sig: unknown,
    now = Date.now(),
  ): Promise<StoredFile | null> {
    if (!PHOTO_NAME.test(name) || typeof expires !== 'string' || typeof sig !== 'string') return null;
    if (!/^\d{1,12}$/.test(expires) || Number(expires) * 1000 <= now) return null;

    const expected = Buffer.from(this.sign(name, Number(expires)));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    return this.store.open(`${PHOTO_FOLDER}/${name}`);
  }

  /** Best-effort delete, used to clean up after a failed write or a replaced photo. */
  async remove(keys: string[]): Promise<void> {
    await this.store.delete(keys);
  }

  private sign(name: string, expires: number): string {
    return createHmac('sha256', this.signingKey)
      .update(`${PHOTO_FOLDER}/${name}\n${expires}`)
      .digest('base64url');
  }
}

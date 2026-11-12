import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppEnv } from '../config/env.validation.js';
import type { AllowedMimeType } from './file-type.js';

/**
 * - `public`: served at `/uploads/...` (profile photos).
 * - `private`: never served (driver licence and insurance documents).
 */
export type Visibility = 'public' | 'private';

const EXTENSIONS: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * Local-disk file storage. Kept behind this service so it can be swapped for
 * S3 or similar later without touching callers.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.root = resolve(config.get('UPLOAD_DIR', { infer: true }));
    this.publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.publicDir, { recursive: true });
    await mkdir(join(this.root, 'private'), { recursive: true });
  }

  /** Directory served as static files under `/uploads`. */
  get publicDir(): string {
    return join(this.root, 'public');
  }

  /** Saves a file and returns its storage key, e.g. `public/photos/<uuid>.jpg`. */
  async save(
    buffer: Buffer,
    mimeType: AllowedMimeType,
    visibility: Visibility,
    folder: string,
  ): Promise<string> {
    const key = `${visibility}/${folder}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
    await mkdir(join(this.root, visibility, folder), { recursive: true });
    await writeFile(join(this.root, key), buffer, { flag: 'wx' });
    return key;
  }

  publicUrl(key: string): string {
    if (!key.startsWith('public/')) {
      throw new Error(`Storage key is not public: ${key}`);
    }
    return `${this.publicBaseUrl}/uploads/${key.slice('public/'.length)}`;
  }

  /** Reverse of publicUrl(). Returns null for URLs this storage did not issue. */
  keyFromPublicUrl(url: string): string | null {
    const prefix = `${this.publicBaseUrl}/uploads/`;
    if (!url.startsWith(prefix)) return null;
    const rest = url.slice(prefix.length);
    if (!rest || rest.split('/').some((part) => part === '..' || part === '')) return null;
    return `public/${rest}`;
  }

  /** Best-effort delete, used to clean up after a failed registration. */
  async remove(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(join(this.root, key), { force: true })));
  }
}

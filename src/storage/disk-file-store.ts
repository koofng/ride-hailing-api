import { createReadStream } from 'node:fs';
import { access, constants, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { FileStore, StoredFile } from './file-store.js';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

/**
 * Stores files under a local directory. Fine for development and tests; not
 * for hosts whose disk is wiped on restart (use GridFS there).
 */
export class DiskFileStore implements FileStore {
  constructor(private readonly root: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.root, 'public'), { recursive: true });
    await mkdir(join(this.root, 'private'), { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async open(key: string): Promise<StoredFile | null> {
    const path = join(this.root, key);
    try {
      const { size } = await stat(path);
      return {
        stream: createReadStream(path),
        size,
        contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => rm(join(this.root, key), { force: true })));
  }

  async ping(): Promise<void> {
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  async close(): Promise<void> {}
}

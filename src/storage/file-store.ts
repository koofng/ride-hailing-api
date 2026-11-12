import type { Readable } from 'node:stream';

/** Injection token for the configured FileStore. */
export const FILE_STORE = Symbol('FILE_STORE');

export interface StoredFile {
  stream: Readable;
  size: number;
  contentType: string;
}

/**
 * Where uploaded file contents live. StorageService owns keys, visibility and
 * signed links; a FileStore only reads and writes bytes by key, so the backend
 * (local disk, MongoDB GridFS, ...) can change without touching callers.
 */
export interface FileStore {
  /** Prepares the backend (directories, connections, indexes). */
  init(): Promise<void>;
  /** Writes a new file. Rejects if a file with this key already exists. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Opens a file for reading, or returns null if there is none with this key. */
  open(key: string): Promise<StoredFile | null>;
  /** Deletes files; keys that do not exist are ignored. */
  delete(keys: string[]): Promise<void>;
  /** Resolves if the backend is reachable; used by the health check. */
  ping(): Promise<void>;
  /** Releases connections on shutdown. */
  close(): Promise<void>;
}

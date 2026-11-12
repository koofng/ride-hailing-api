import { Logger } from '@nestjs/common';
import { GridFSBucket, MongoClient, type Db } from 'mongodb';
import type { FileStore, StoredFile } from './file-store.js';

/**
 * Stores files in MongoDB GridFS (e.g. MongoDB Atlas), so uploads survive
 * hosts whose local disk is wiped on every deploy or restart. A file's
 * storage key is its GridFS filename.
 */
export class GridFsFileStore implements FileStore {
  private readonly logger = new Logger(GridFsFileStore.name);
  private readonly client: MongoClient;
  private db?: Db;
  private bucket?: GridFSBucket;

  constructor(
    uri: string,
    private readonly bucketName = 'uploads',
  ) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  }

  async init(): Promise<void> {
    await this.client.connect();
    // The database comes from the connection string (validated at startup).
    this.db = this.client.db();
    this.bucket = new GridFSBucket(this.db, { bucketName: this.bucketName });
    // One file per key, like the disk store's exclusive create.
    await this.db
      .collection(`${this.bucketName}.files`)
      .createIndex({ filename: 1 }, { unique: true, name: 'UQ_filename' });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const bucket = this.requireBucket();
    const upload = bucket.openUploadStream(key, { metadata: { contentType } });
    try {
      await new Promise<void>((resolve, reject) => {
        upload.once('finish', () => resolve());
        upload.once('error', reject);
        upload.end(data);
      });
    } catch (error) {
      // GridFS writes the chunks before the file document; if the document
      // was rejected (e.g. duplicate key), remove the orphaned chunks.
      await this.requireDb()
        .collection(`${this.bucketName}.chunks`)
        .deleteMany({ files_id: upload.id })
        .catch(() => undefined);
      throw error;
    }
  }

  async open(key: string): Promise<StoredFile | null> {
    const bucket = this.requireBucket();
    const file = await bucket.find({ filename: key }).limit(1).next();
    if (!file) return null;
    return {
      stream: bucket.openDownloadStream(file._id),
      size: file.length,
      contentType:
        typeof file.metadata?.contentType === 'string'
          ? file.metadata.contentType
          : 'application/octet-stream',
    };
  }

  async delete(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const bucket = this.requireBucket();
    const files = await bucket.find({ filename: { $in: keys } }).toArray();
    await Promise.all(
      files.map((file) =>
        // Already gone (e.g. deleted concurrently) is fine.
        bucket.delete(file._id).catch((error: unknown) => {
          this.logger.warn(`Could not delete ${file.filename}: ${String(error)}`);
        }),
      ),
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private requireBucket(): GridFSBucket {
    if (!this.bucket) throw new Error('GridFsFileStore used before init()');
    return this.bucket;
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('GridFsFileStore used before init()');
    return this.db;
  }
}

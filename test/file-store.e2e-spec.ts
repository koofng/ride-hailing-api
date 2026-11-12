import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { MongoClient } from 'mongodb';
import { DiskFileStore } from '../src/storage/disk-file-store.js';
import type { FileStore } from '../src/storage/file-store.js';
import { GridFsFileStore } from '../src/storage/gridfs-file-store.js';

const MONGO_URI = process.env.TEST_MONGODB_URI!;
const BUCKET = 'contract_test';

interface Backend {
  make(): Promise<FileStore>;
  cleanUp(): Promise<void>;
}

const backends: Record<string, () => Backend> = {
  disk: () => {
    let dir = '';
    return {
      make: async () => new DiskFileStore((dir = await mkdtemp(join(tmpdir(), 'file-store-')))),
      cleanUp: () => rm(dir, { recursive: true, force: true }),
    };
  },
  gridfs: () => ({
    make: async () => new GridFsFileStore(MONGO_URI, BUCKET),
    cleanUp: async () => {
      const client = await MongoClient.connect(MONGO_URI);
      await client.db().collection(`${BUCKET}.files`).deleteMany({});
      await client.db().collection(`${BUCKET}.chunks`).deleteMany({});
      await client.close();
    },
  }),
};

/** The same behaviour is required of every FileStore. */
describe.each(Object.keys(backends))('%s FileStore', (name) => {
  const backend = backends[name]();
  let store: FileStore;

  beforeEach(async () => {
    store = await backend.make();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await backend.cleanUp();
  });

  const KEY = 'public/photos/3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11.png';

  it('stores a file and reads back the same bytes, size and type', async () => {
    await store.put(KEY, Buffer.from('hello'), 'image/png');
    const file = await store.open(KEY);
    expect(file).toMatchObject({ size: 5, contentType: 'image/png' });
    expect(await text(file!.stream)).toBe('hello');
  });

  it('keeps binary content intact, including files larger than one GridFS chunk', async () => {
    const data = Buffer.alloc(600 * 1024, 0xab);
    data[0] = 0x89;
    await store.put(KEY, data, 'image/png');
    const file = await store.open(KEY);
    const chunks: Buffer[] = [];
    for await (const chunk of file!.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(data)).toBe(true);
  });

  it('returns null for a key that does not exist', async () => {
    expect(await store.open('public/photos/missing.png')).toBeNull();
  });

  it('refuses to overwrite an existing key', async () => {
    await store.put(KEY, Buffer.from('first'), 'image/png');
    await expect(store.put(KEY, Buffer.from('second'), 'image/png')).rejects.toThrow();
    expect(await text((await store.open(KEY))!.stream)).toBe('first');
  });

  it('keeps private and public keys apart', async () => {
    await store.put('private/driver-documents/a.pdf', Buffer.from('%PDF'), 'application/pdf');
    expect(await store.open('public/driver-documents/a.pdf')).toBeNull();
    expect((await store.open('private/driver-documents/a.pdf'))?.contentType).toBe('application/pdf');
  });

  it('deletes files and ignores keys that do not exist', async () => {
    await store.put(KEY, Buffer.from('x'), 'image/png');
    await store.delete([KEY, 'public/photos/never-existed.png']);
    expect(await store.open(KEY)).toBeNull();
    await expect(store.delete([KEY])).resolves.toBeUndefined();
  });
});

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import type { AppEnv } from '../config/env.validation.js';
import { DiskFileStore } from './disk-file-store.js';
import { FILE_STORE, type FileStore } from './file-store.js';
import { FilesController } from './files.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [FilesController],
  providers: [
    StorageService,
    {
      provide: FILE_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): FileStore =>
        new DiskFileStore(resolve(config.get('UPLOAD_DIR', { infer: true }))),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}

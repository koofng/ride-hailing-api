import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [FilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}

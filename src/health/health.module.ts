import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}

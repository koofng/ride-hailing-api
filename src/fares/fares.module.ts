import { Module } from '@nestjs/common';
import { FaresController } from './fares.controller.js';
import { FaresService } from './fares.service.js';

@Module({
  controllers: [FaresController],
  providers: [FaresService],
  exports: [FaresService],
})
export class FaresModule {}

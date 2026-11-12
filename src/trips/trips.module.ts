import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module.js';
import { Trip } from './entities/trip.entity.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Trip]), StorageModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module.js';
import { DriverTripsController } from './driver-trips.controller.js';
import { DriverTripsService } from './driver-trips.service.js';
import { Trip } from './entities/trip.entity.js';
import { TripExpiryService } from './trip-expiry.service.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Trip]), StorageModule],
  // DriverTripsController first: its fixed paths (/trips/requests) must be
  // matched before TripsController's /trips/:tripId.
  controllers: [DriverTripsController, TripsController],
  providers: [TripsService, DriverTripsService, TripExpiryService],
})
export class TripsModule {}

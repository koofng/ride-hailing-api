import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversModule } from '../drivers/drivers.module.js';
import { FaresModule } from '../fares/fares.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DriverTripsController } from './driver-trips.controller.js';
import { DriverTripsService } from './driver-trips.service.js';
import { TripDecline } from './entities/trip-decline.entity.js';
import { Trip } from './entities/trip.entity.js';
import { TripEvents } from './trip-events.js';
import { TripExpiryService } from './trip-expiry.service.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Trip, TripDecline]), StorageModule, DriversModule, FaresModule],
  // DriverTripsController first: its fixed paths (/trips/requests) must be
  // matched before TripsController's /trips/:tripId.
  controllers: [DriverTripsController, TripsController],
  providers: [TripsService, DriverTripsService, TripExpiryService, TripEvents],
  exports: [TripEvents],
})
export class TripsModule {}

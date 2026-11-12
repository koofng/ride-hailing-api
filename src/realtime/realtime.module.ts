import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { Trip } from '../trips/entities/trip.entity.js';
import { TripsModule } from '../trips/trips.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { TripNotifier } from './trip-notifier.js';

@Module({
  imports: [
    AuthModule,
    TripsModule,
    DriversModule,
    StorageModule,
    TypeOrmModule.forFeature([Trip]),
  ],
  providers: [RealtimeGateway, TripNotifier],
})
export class RealtimeModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trip } from '../trips/entities/trip.entity.js';
import { DriverDetails } from '../users/entities/driver-details.entity.js';
import { UsersModule } from '../users/users.module.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DriverDetails, Trip]), UsersModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module.js';
import { DriverDetails } from './entities/driver-details.entity.js';
import { User } from './entities/user.entity.js';
import { ProfileService } from './profile.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, DriverDetails]), StorageModule],
  controllers: [UsersController],
  providers: [UsersService, ProfileService],
  exports: [UsersService],
})
export class UsersModule {}

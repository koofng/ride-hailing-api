import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DriverDetails } from './entities/driver-details.entity.js';
import { User } from './entities/user.entity.js';
import { Role } from './role.enum.js';

export interface NewUser {
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  photoKey?: string | null;
}

export type NewDriverDetails = Omit<
  DriverDetails,
  'userId' | 'user' | 'available' | 'lastLat' | 'lastLng' | 'locationUpdatedAt'
>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(DriverDetails)
    private readonly driverDetails: Repository<DriverDetails>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Looks up a user for login, including the password hash. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.driverDetails', 'driverDetails')
      .where('user.email = :email', { email })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id }, relations: { driverDetails: true } });
  }

  async isEmailOrPhoneTaken(email: string, phone: string): Promise<boolean> {
    return this.users.exists({ where: [{ email }, { phone }] });
  }

  async isPlateTaken(plateNumber: string): Promise<boolean> {
    return this.driverDetails.exists({ where: { plateNumber } });
  }

  async createPassenger(data: NewUser): Promise<User> {
    const user = await this.users.save(
      this.users.create({ ...data, role: Role.PASSENGER, photoKey: data.photoKey ?? null }),
    );
    user.driverDetails = null;
    return user;
  }

  /** Creates the user row and its driver_details row in one transaction. */
  async createDriver(data: NewUser, details: NewDriverDetails): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, { ...data, role: Role.DRIVER, photoKey: data.photoKey ?? null }),
      );
      user.driverDetails = await manager.save(
        manager.create(DriverDetails, { ...details, userId: user.id, available: false }),
      );
      return user;
    });
  }

  async updateFullName(userId: string, fullName: string): Promise<void> {
    await this.users.update({ id: userId }, { fullName });
  }

  async updatePhotoKey(userId: string, photoKey: string): Promise<void> {
    await this.users.update({ id: userId }, { photoKey });
  }

  /** Going offline also forgets the Driver's position, so offline Drivers are not tracked. */
  async setDriverAvailability(userId: string, available: boolean): Promise<void> {
    await this.driverDetails.update(
      { userId },
      available ? { available } : { available, lastLat: null, lastLng: null, locationUpdatedAt: null },
    );
  }
}

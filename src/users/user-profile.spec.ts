import { InternalServerErrorException } from '@nestjs/common';
import { DriverDetails } from './entities/driver-details.entity.js';
import { User } from './entities/user.entity.js';
import { Role } from './role.enum.js';
import { toUserProfile } from './user-profile.js';

const baseUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: '3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11',
    role: Role.PASSENGER,
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+19025551234',
    passwordHash: '$2b$10$secret',
    photoUrl: null,
    createdAt: new Date('2026-11-01T14:20:00Z'),
    updatedAt: new Date('2026-11-01T14:20:00Z'),
    ...overrides,
  });

describe('toUserProfile', () => {
  it('maps a Passenger to the spec example shape', () => {
    expect(toUserProfile(baseUser({ driverDetails: null }))).toEqual({
      id: '3f6c1b2a-8d4e-4f0a-9b1c-2e7d5a9c4f11',
      role: 'PASSENGER',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+19025551234',
      photoUrl: null,
      createdAt: '2026-11-01T14:20:00.000Z',
      driverDetails: null,
    });
  });

  it('never exposes the password hash or private document keys', () => {
    const details = Object.assign(new DriverDetails(), {
      licenceNumber: 'NS1234567',
      licenceImageKey: 'private/driver-documents/a.jpg',
      insuranceDocumentKey: 'private/driver-documents/b.pdf',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleColour: 'Silver',
      plateNumber: 'ABC 123',
      available: false,
    });
    const json = JSON.stringify(toUserProfile(baseUser({ role: Role.DRIVER, driverDetails: details })));
    expect(json).not.toContain('secret');
    expect(json).not.toContain('private/');
  });

  it('nests vehicle fields under driverDetails.vehicle for Drivers', () => {
    const details = Object.assign(new DriverDetails(), {
      licenceNumber: 'NS1234567',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleColour: 'Silver',
      plateNumber: 'ABC 123',
      available: true,
    });
    expect(toUserProfile(baseUser({ role: Role.DRIVER, driverDetails: details })).driverDetails).toEqual({
      licenceNumber: 'NS1234567',
      vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plateNumber: 'ABC 123' },
      available: true,
    });
  });

  it('refuses to return a Driver without driverDetails (spec invariant)', () => {
    expect(() => toUserProfile(baseUser({ role: Role.DRIVER, driverDetails: null }))).toThrow(
      InternalServerErrorException,
    );
  });

  it('always returns driverDetails null for a Passenger', () => {
    const stray = new DriverDetails();
    expect(toUserProfile(baseUser({ driverDetails: stray })).driverDetails).toBeNull();
  });
});

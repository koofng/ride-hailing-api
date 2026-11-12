import { InternalServerErrorException } from '@nestjs/common';
import { DriverDetails } from '../users/entities/driver-details.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Role } from '../users/role.enum.js';
import { Trip } from './entities/trip.entity.js';
import { CancelReason, PassengerCancelReason, TripStatus } from './trip.enums.js';
import { toTripView } from './trip-view.js';

const sign = (key: string) => `signed:${key}`;

const passenger = Object.assign(new User(), {
  id: 'p1',
  role: Role.PASSENGER,
  fullName: 'Jane Doe',
  phone: '+19025551234',
  photoKey: 'public/photos/p.jpg',
});

const driver = Object.assign(new User(), {
  id: 'd1',
  role: Role.DRIVER,
  fullName: 'John Smith',
  phone: '+19025559876',
  photoKey: null,
  driverDetails: Object.assign(new DriverDetails(), {
    vehicleMake: 'Toyota',
    vehicleModel: 'Corolla',
    vehicleColour: 'Silver',
    plateNumber: 'ABC 123',
  }),
});

const trip = (status: TripStatus, overrides: Partial<Trip> = {}): Trip =>
  Object.assign(new Trip(), {
    id: 't1',
    passengerId: 'p1',
    passenger,
    driverId: status === TripStatus.REQUESTED ? null : 'd1',
    driver: status === TripStatus.REQUESTED ? null : driver,
    status,
    originLat: 45.6169,
    originLng: -61.9986,
    originAddress: '1 West St',
    destinationLat: 45.6175,
    destinationLng: -61.9933,
    destinationAddress: null,
    fareAmount: 8,
    fareCurrency: 'CAD',
    cancelReason: null,
    passengerCancelReason: null,
    cancelNote: null,
    requestedAt: new Date('2026-11-12T10:00:00Z'),
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  });

const cancelled = (driverId: string | null) =>
  trip(TripStatus.CANCELLED, {
    driverId,
    driver: driverId ? driver : null,
    cancelReason: CancelReason.PASSENGER_CANCELLED,
    passengerCancelReason: PassengerCancelReason.OTHER,
    cancelNote: 'Found another ride',
    cancelledAt: new Date('2026-11-12T10:05:00Z'),
  });

const asPassenger = { id: 'p1', role: Role.PASSENGER };
const asDriver = { id: 'd1', role: Role.DRIVER };

describe('toTripView', () => {
  it('maps places, fare and timestamps', () => {
    const view = toTripView(trip(TripStatus.REQUESTED), asPassenger, sign);
    expect(view).toMatchObject({
      origin: { lat: 45.6169, lng: -61.9986, address: '1 West St' },
      destination: { lat: 45.6175, lng: -61.9933, address: null },
      fare: { amount: 8, currency: 'CAD' },
      requestedAt: '2026-11-12T10:00:00.000Z',
      acceptedAt: null,
    });
  });

  describe('Passenger viewing their own trip', () => {
    it('sees themselves and the Driver, with signed photo links', () => {
      const view = toTripView(trip(TripStatus.ACCEPTED), asPassenger, sign);
      expect(view.passenger).toEqual({
        id: 'p1',
        fullName: 'Jane Doe',
        phone: '+19025551234',
        photoUrl: 'signed:public/photos/p.jpg',
      });
      expect(view.driver).toEqual({
        id: 'd1',
        fullName: 'John Smith',
        phone: '+19025559876',
        photoUrl: null,
        vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plateNumber: 'ABC 123' },
      });
    });

    it('sees driver null before a Driver accepts', () => {
      expect(toTripView(trip(TripStatus.REQUESTED), asPassenger, sign).driver).toBeNull();
    });

    it('does not see the Driver on a cancelled trip', () => {
      expect(toTripView(cancelled('d1'), asPassenger, sign).driver).toBeNull();
    });

    it('sees their own cancellation reason', () => {
      const view = toTripView(cancelled(null), asPassenger, sign);
      expect(view.cancelReason).toBe('PASSENGER_CANCELLED');
      expect(view.cancelDetails).toEqual({ reason: 'OTHER', note: 'Found another ride' });
    });
  });

  describe('Driver viewing a trip they are on', () => {
    it.each([TripStatus.ACCEPTED, TripStatus.DRIVER_ARRIVED, TripStatus.IN_PROGRESS, TripStatus.COMPLETED])(
      'sees the Passenger while %s',
      (status) => {
        expect(toTripView(trip(status), asDriver, sign).passenger).toMatchObject({ id: 'p1' });
      },
    );

    it('does not see the Passenger, or their reason, on a cancelled trip', () => {
      const view = toTripView(cancelled('d1'), asDriver, sign);
      expect(view.passenger).toBeNull();
      expect(view.cancelDetails).toBeNull();
      expect(view.driver).toMatchObject({ id: 'd1' });
    });
  });

  it.each([
    ['another Passenger', { id: 'p2', role: Role.PASSENGER }],
    ['another Driver', { id: 'd2', role: Role.DRIVER }],
    ['the Passenger id with the Driver role', { id: 'p1', role: Role.DRIVER }],
  ])('refuses to build a view for %s (callers must check access first)', (_label, viewer) => {
    expect(() => toTripView(trip(TripStatus.ACCEPTED), viewer, sign)).toThrow(InternalServerErrorException);
  });
});

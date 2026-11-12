import { User } from '../users/entities/user.entity.js';
import { Trip } from './entities/trip.entity.js';
import { firstName, toTripRequest } from './trip-request-view.js';

describe('firstName', () => {
  it.each([
    ['Jane Doe', 'Jane'],
    ['  Jane   Q. Doe ', 'Jane'],
    ['Madonna', 'Madonna'],
    ['', ''],
  ])('%j -> %j', (full, first) => {
    expect(firstName(full)).toBe(first);
  });
});

describe('toTripRequest', () => {
  const trip = Object.assign(new Trip(), {
    id: 't1',
    originLat: 45.6175,
    originLng: -61.9933,
    originAddress: 'St. F.X.',
    destinationLat: 45.6169,
    destinationLng: -61.9986,
    passenger: Object.assign(new User(), { fullName: 'Jane Doe', phone: '+19025551234' }),
  });

  it('shows the pickup, distance, first name and expiry, nothing about the destination', () => {
    const view = toTripRequest(trip, { lat: 45.6169, lng: -61.9986 }, new Date('2026-11-12T10:02:00Z'));
    expect(view).toEqual({
      tripId: 't1',
      pickup: { lat: 45.6175, lng: -61.9933, address: 'St. F.X.' },
      distanceKm: 0.4,
      passengerName: 'Jane',
      expiresAt: '2026-11-12T10:02:00.000Z',
    });
    expect(JSON.stringify(view)).not.toContain('+19025551234');
  });

  it('rounds the distance to one decimal place', () => {
    const view = toTripRequest(trip, { lat: 45.7, lng: -61.9933 }, new Date());
    expect(view.distanceKm).toBe(9.2);
  });
});

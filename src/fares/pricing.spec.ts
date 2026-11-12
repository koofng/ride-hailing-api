import { distanceKm, etaSeconds, isWithinServiceArea, SERVICE_AREA } from './pricing.js';

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(SERVICE_AREA, SERVICE_AREA)).toBe(0);
  });

  it('matches a known distance (Antigonish to Halifax is about 160 km)', () => {
    expect(distanceKm(SERVICE_AREA, { lat: 44.6488, lng: -63.5752 })).toBeCloseTo(161, -1);
  });
});

describe('isWithinServiceArea', () => {
  it.each([
    ['the town centre', { lat: 45.6169, lng: -61.9986 }],
    ['St. F.X. University', { lat: 45.6175, lng: -61.9933 }],
    ['about 9 km north', { lat: 45.6979, lng: -61.9986 }],
  ])('accepts %s', (_label, point) => {
    expect(isWithinServiceArea(point)).toBe(true);
  });

  it.each([
    ['about 11 km north', { lat: 45.7159, lng: -61.9986 }],
    ['New Glasgow', { lat: 45.5869, lng: -62.6453 }],
    ['Halifax', { lat: 44.6488, lng: -63.5752 }],
  ])('rejects %s', (_label, point) => {
    expect(isWithinServiceArea(point)).toBe(false);
  });
});

describe('etaSeconds', () => {
  it.each([
    [0, 0],
    [1, 120],
    [2.5, 300],
    [0.4, 48],
  ])('%s km at 30 km/h -> %s s', (km, seconds) => {
    expect(etaSeconds(km)).toBe(seconds);
  });
});

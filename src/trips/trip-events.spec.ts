import { TripEvents, type TripEvent } from './trip-events.js';

const event: TripEvent = { type: 'requested', tripId: 't1', passengerId: 'p1' };

describe('TripEvents', () => {
  it('delivers each event to every listener', () => {
    const events = new TripEvents();
    const a = vi.fn();
    const b = vi.fn();
    events.subscribe(a);
    events.subscribe(b);
    events.publish(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('a listener that throws or rejects never affects the publisher or other listeners', async () => {
    const events = new TripEvents();
    const after = vi.fn();
    events.subscribe(() => {
      throw new Error('sync failure');
    });
    events.subscribe(() => Promise.reject(new Error('async failure')));
    events.subscribe(after);

    expect(() => events.publish(event)).not.toThrow();
    expect(after).toHaveBeenCalledWith(event);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('unsubscribes', () => {
    const events = new TripEvents();
    const listener = vi.fn();
    const unsubscribe = events.subscribe(listener);
    unsubscribe();
    events.publish(event);
    expect(listener).not.toHaveBeenCalled();
  });
});

import { isCliUpdateAvailable, wasCliVersionUnchanged } from '@/core/install/CliUpdateService';

describe('isCliUpdateAvailable', () => {
  it('is true only when both versions parse and latest is newer', () => {
    expect(isCliUpdateAvailable('2.1.0', '2.2.0')).toBe(true);
    expect(isCliUpdateAvailable('2.2.0', '2.2.0')).toBe(false);
    expect(isCliUpdateAvailable('2.2.0', '2.1.9')).toBe(false);
    expect(isCliUpdateAvailable(null, '2.2.0')).toBe(false);
    expect(isCliUpdateAvailable('2.1.0', null)).toBe(false);
  });
});

describe('wasCliVersionUnchanged', () => {
  it('is true when the binary still reports the same or an older version', () => {
    expect(wasCliVersionUnchanged('0.35.0', '0.35.0')).toBe(true);
    expect(wasCliVersionUnchanged('0.35.0', '0.34.0')).toBe(true);
  });

  it('is false when the version advanced, or when we could not re-read it', () => {
    expect(wasCliVersionUnchanged('0.35.0', '0.37.0')).toBe(false);
    expect(wasCliVersionUnchanged('0.35.0', null)).toBe(false);
    expect(wasCliVersionUnchanged(null, '0.37.0')).toBe(false);
  });
});

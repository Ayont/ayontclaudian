import { isCliUpdateAvailable } from '@/core/install/CliUpdateService';

describe('isCliUpdateAvailable', () => {
  it('is true only when both versions parse and latest is newer', () => {
    expect(isCliUpdateAvailable('2.1.0', '2.2.0')).toBe(true);
    expect(isCliUpdateAvailable('2.2.0', '2.2.0')).toBe(false);
    expect(isCliUpdateAvailable('2.2.0', '2.1.9')).toBe(false);
    expect(isCliUpdateAvailable(null, '2.2.0')).toBe(false);
    expect(isCliUpdateAvailable('2.1.0', null)).toBe(false);
  });
});

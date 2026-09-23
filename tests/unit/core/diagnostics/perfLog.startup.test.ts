import { buildStartupProfile, perfSince } from '@/core/diagnostics/perfLog';

describe('buildStartupProfile', () => {
  // Written after each start so a slow start can be diagnosed from the file,
  // without devtools.
  it('lists every recorded measurement, slowest first', () => {
    perfSince(performance.now() - 40, 'startup-test-fast');
    perfSince(performance.now() - 400, 'startup-test-slow');

    const profile = buildStartupProfile(1_000);
    const keys = profile.marks.map(mark => mark.key);

    expect(profile.writtenAt).toBe(1_000);
    expect(keys.indexOf('startup-test-slow')).toBeLessThan(keys.indexOf('startup-test-fast'));
    expect(profile.marks.find(mark => mark.key === 'startup-test-slow')?.ms).toBeGreaterThanOrEqual(399);
  });
});

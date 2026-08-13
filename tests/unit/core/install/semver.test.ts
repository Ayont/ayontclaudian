import { compareSemver, parseCliVersion } from '@/core/install/semver';

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('5.96.0', '5.95.2')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v2.0.0', '2.1.0')).toBeLessThan(0);
  });
});

describe('parseCliVersion', () => {
  it('extracts the first semver from noisy CLI banners', () => {
    expect(parseCliVersion('2.1.219 (Claude Code)')).toBe('2.1.219');
    expect(parseCliVersion('codex-cli 0.42.1')).toBe('0.42.1');
    expect(parseCliVersion('no version here')).toBeNull();
  });
});

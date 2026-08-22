import { compareSemver, parseCliVersion } from '@/core/install/semver';

describe('compareSemver', () => {
  it('orders versions', () => {
    expect(compareSemver('5.96.0', '5.95.2')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v2.0.0', '2.1.0')).toBeLessThan(0);
  });

  it('places a pre-release below its release line (semver precedence)', () => {
    expect(compareSemver('1.0.1-beta', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('1.0.1', '1.0.1-beta')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0-alpha', '2.0.0')).toBeLessThan(0);
  });

  it('orders pre-release identifiers by the semver rules', () => {
    // alpha < beta (lower when compared as dot-separated identifiers)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    // a release still outranks every pre-release of the same numeric line
    expect(compareSemver('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
  });
});

describe('parseCliVersion', () => {
  it('extracts the first semver from noisy CLI banners', () => {
    expect(parseCliVersion('2.1.219 (Claude Code)')).toBe('2.1.219');
    expect(parseCliVersion('codex-cli 0.42.1')).toBe('0.42.1');
    expect(parseCliVersion('no version here')).toBeNull();
  });
});
import * as path from 'node:path';

import {
  resolveOmpAgentDir,
  resolveOmpHomeDir,
  resolveOmpSessionsDir,
} from '@/providers/omp/runtime/OmpPaths';

/**
 * Both layouts were read back from the CLI itself with `omp config path`
 * (v18.2.3), which is the only authoritative source for these directories.
 */
describe('omp paths', () => {
  const HOME = '/Users/tester';

  it('resolves the default agent dir to ~/.omp/agent', () => {
    expect(resolveOmpAgentDir({ HOME })).toBe(path.join(HOME, '.omp', 'agent'));
  });

  it('resolves a named profile to ~/.omp/profiles/<name>/agent', () => {
    expect(resolveOmpAgentDir({ HOME, OMP_PROFILE: 'work' }))
      .toBe(path.join(HOME, '.omp', 'profiles', 'work', 'agent'));
  });

  it('ignores a blank profile rather than creating a nameless profile dir', () => {
    expect(resolveOmpAgentDir({ HOME, OMP_PROFILE: '   ' }))
      .toBe(path.join(HOME, '.omp', 'agent'));
  });

  it('puts sessions under the resolved agent dir', () => {
    expect(resolveOmpSessionsDir({ HOME, OMP_PROFILE: 'work' }))
      .toBe(path.join(HOME, '.omp', 'profiles', 'work', 'agent', 'sessions'));
  });

  it('uses ~/.omp, not an XDG data dir', () => {
    expect(resolveOmpHomeDir({ HOME, XDG_DATA_HOME: '/xdg/share' }))
      .toBe(path.join(HOME, '.omp'));
  });
});

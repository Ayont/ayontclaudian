import * as path from 'node:path';

import {
  resolveHermesHome,
  resolveHermesStateDbPath,
} from '@/providers/hermes/runtime/HermesPaths';

describe('resolveHermesHome', () => {
  it('honours an explicit HERMES_HOME on every platform', () => {
    expect(resolveHermesHome({ HERMES_HOME: '/srv/hermes-work' }, 'darwin')).toBe('/srv/hermes-work');
    expect(resolveHermesHome({ HERMES_HOME: '/srv/hermes-work' }, 'win32')).toBe('/srv/hermes-work');
  });

  it('falls back to ~/.hermes on POSIX', () => {
    expect(resolveHermesHome({ HOME: '/Users/ayont' }, 'darwin'))
      .toBe(path.join('/Users/ayont', '.hermes'));
  });

  it('uses %LOCALAPPDATA%\\hermes on Windows', () => {
    expect(resolveHermesHome({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32'))
      .toBe(path.join('C:\\Users\\a\\AppData\\Local', 'hermes'));
  });

  it('derives the Windows fallback from the user profile when LOCALAPPDATA is unset', () => {
    expect(resolveHermesHome({ USERPROFILE: 'C:\\Users\\a' }, 'win32'))
      .toBe(path.join('C:\\Users\\a', 'AppData', 'Local', 'hermes'));
  });
});

describe('resolveHermesStateDbPath', () => {
  it('points at the shared session store inside the resolved home', () => {
    expect(resolveHermesStateDbPath({ HERMES_HOME: '/srv/hermes-work' }, 'darwin'))
      .toBe(path.join('/srv/hermes-work', 'state.db'));
  });
});

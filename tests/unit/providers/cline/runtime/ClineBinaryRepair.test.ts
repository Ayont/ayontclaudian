import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildClineCodesignRepairArgs,
  buildClineQuarantineClearArgs,
  findClineCompiledBinary,
  shouldRetryClineSignatureKill,
} from '@/providers/cline/runtime/ClineBinaryRepair';
import * as cliBinaryLocator from '@/utils/cliBinaryLocator';

describe('findClineCompiledBinary', () => {
  it('finds the sibling Bun binary next to the Node wrapper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const wrapper = path.join(dir, 'cline');
    const native = path.join(dir, '.cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    expect(findClineCompiledBinary(wrapper)).toBe(fs.realpathSync(native));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when there is no compiled sibling', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const wrapper = path.join(dir, 'cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    expect(findClineCompiledBinary(wrapper)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('follows the npm bin symlink to the real package folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const packageBin = path.join(root, 'lib', 'node_modules', 'cline', 'bin');
    const shimDir = path.join(root, 'bin');
    fs.mkdirSync(packageBin, { recursive: true });
    fs.mkdirSync(shimDir, { recursive: true });
    const wrapper = path.join(packageBin, 'cline');
    const native = path.join(packageBin, '.cline');
    const shim = path.join(shimDir, 'cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    fs.symlinkSync(wrapper, shim);
    try {
      expect(findClineCompiledBinary(shim)).toBe(fs.realpathSync(native));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves a bare cline command via PATH so the sibling .cline is still found', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const wrapper = path.join(dir, 'cline');
    const native = path.join(dir, '.cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    const spy = jest.spyOn(cliBinaryLocator, 'findCliBinaryPath').mockReturnValue(wrapper);
    try {
      expect(findClineCompiledBinary('cline')).toBe(fs.realpathSync(native));
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildClineCodesignRepairArgs', () => {
  it('builds an ad-hoc resign so macOS stops SIGKILL-ing a broken npm copy', () => {
    expect(buildClineCodesignRepairArgs('/opt/cline/.cline')).toEqual([
      '--force',
      '--sign',
      '-',
      '/opt/cline/.cline',
    ]);
  });
});

describe('buildClineQuarantineClearArgs', () => {
  it('clears the quarantine flag that still SIGKILLs an ad-hoc signed binary', () => {
    expect(buildClineQuarantineClearArgs('/opt/cline/.cline')).toEqual([
      '-d',
      'com.apple.quarantine',
      '/opt/cline/.cline',
    ]);
  });
});

describe('shouldRetryClineSignatureKill', () => {
  it('retries once when macOS kills Cline before any output', () => {
    expect(shouldRetryClineSignatureKill({
      alreadyRetried: false,
      cancelled: false,
      exitCode: null,
      producedOutput: false,
    })).toBe(true);
  });

  it('does not retry after a real exit code, output, cancel, or a second kill', () => {
    expect(shouldRetryClineSignatureKill({
      alreadyRetried: false,
      cancelled: false,
      exitCode: 1,
      producedOutput: false,
    })).toBe(false);
    expect(shouldRetryClineSignatureKill({
      alreadyRetried: false,
      cancelled: false,
      exitCode: null,
      producedOutput: true,
    })).toBe(false);
    expect(shouldRetryClineSignatureKill({
      alreadyRetried: false,
      cancelled: true,
      exitCode: null,
      producedOutput: false,
    })).toBe(false);
    expect(shouldRetryClineSignatureKill({
      alreadyRetried: true,
      cancelled: false,
      exitCode: null,
      producedOutput: false,
    })).toBe(false);
  });
});

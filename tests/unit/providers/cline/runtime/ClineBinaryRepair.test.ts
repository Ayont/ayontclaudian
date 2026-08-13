import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildClineCodesignRepairArgs,
  findClineCompiledBinary,
} from '@/providers/cline/runtime/ClineBinaryRepair';

describe('findClineCompiledBinary', () => {
  it('finds the sibling Bun binary next to the Node wrapper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const wrapper = path.join(dir, 'cline');
    const native = path.join(dir, '.cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    expect(findClineCompiledBinary(wrapper)).toBe(native);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when there is no compiled sibling', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-repair-'));
    const wrapper = path.join(dir, 'cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    expect(findClineCompiledBinary(wrapper)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
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

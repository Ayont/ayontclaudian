import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveClineNativeBinary } from '@/providers/cline/runtime/ClineCliResolver';

describe('resolveClineNativeBinary', () => {
  it('keeps the Node wrapper so Electron does not spawn the Bun binary directly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-bin-'));
    const wrapper = path.join(dir, 'cline');
    const native = path.join(dir, '.cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    expect(resolveClineNativeBinary(wrapper)).toBe(wrapper);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveClineNativeBinary } from '@/providers/cline/runtime/ClineCliResolver';

describe('resolveClineNativeBinary', () => {
  it('prefers the sibling compiled .cline binary over the Node wrapper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-bin-'));
    const wrapper = path.join(dir, 'cline');
    const native = path.join(dir, '.cline');
    fs.writeFileSync(wrapper, '#!/usr/bin/env node\n');
    fs.writeFileSync(native, 'native');
    expect(resolveClineNativeBinary(wrapper)).toBe(native);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

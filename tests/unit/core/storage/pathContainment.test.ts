import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isPathWithinRoot } from '@/core/storage/pathContainment';

describe('isPathWithinRoot', () => {
  it('uses path segments instead of string prefixes', () => {
    expect(isPathWithinRoot('/home/user/.opencode/a.db', '/home/user/.opencode')).toBe(true);
    expect(isPathWithinRoot('/home/user/.opencode-evil/a.db', '/home/user/.opencode')).toBe(false);
    expect(isPathWithinRoot('/home/user/.opencode/../secrets/a.db', '/home/user/.opencode')).toBe(false);
  });

  it('supports Windows drive and UNC paths independently of the host', () => {
    expect(isPathWithinRoot('C:\\Users\\me\\opencode\\a.db', 'C:\\Users\\me\\opencode')).toBe(true);
    expect(isPathWithinRoot('D:\\Users\\me\\opencode\\a.db', 'C:\\Users\\me\\opencode')).toBe(false);
    expect(isPathWithinRoot('\\\\wsl$\\Ubuntu\\home\\me\\a.db', '\\\\wsl$\\Ubuntu\\home\\me')).toBe(true);
  });

  it('rejects an existing symlink that escapes the trusted root', () => {
    if (process.platform === 'win32') return;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-path-trust-'));
    const root = path.join(tempDir, 'root');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'opencode.db'), '{}');
    fs.symlinkSync(outside, path.join(root, 'escape'));

    expect(isPathWithinRoot(path.join(root, 'escape', 'opencode.db'), root)).toBe(false);
    expect(isPathWithinRoot(path.join(root, 'escape', 'not-created-yet.db'), root)).toBe(false);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

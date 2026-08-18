import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Platform, requestUrl } from 'obsidian';

import { PluginUpdater } from '@/app/update/PluginUpdater';

function asset(body: string) {
  const bytes = Buffer.from(body, 'utf8');
  return {
    text: '',
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('PluginUpdater.installUpdate', () => {
  let root: string;
  const originalDesktop = (Platform as { isDesktop?: boolean }).isDesktop;

  beforeEach(() => {
    (Platform as { isDesktop?: boolean }).isDesktop = true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plugin-update-'));
    fs.mkdirSync(path.join(root, '.obsidian', 'plugins', 'realclaudian'), { recursive: true });
    (requestUrl as jest.Mock).mockReset();
  });

  afterEach(() => {
    (Platform as { isDesktop?: boolean }).isDesktop = originalDesktop;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makePlugin() {
    return {
      manifest: { id: 'realclaudian', version: '5.99.6' },
      app: {
        vault: {
          adapter: { getBasePath: () => root },
          configDir: '.obsidian',
        },
        commands: { executeCommandById: jest.fn().mockReturnValue(true) },
      },
    } as unknown as ConstructorParameters<typeof PluginUpdater>[0];
  }

  it('writes octet-stream assets and fails when the on-disk version did not change', async () => {
    (requestUrl as jest.Mock).mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith('manifest.json')) {
        return asset('{"id":"realclaudian","version":"5.99.6"}');
      }
      return asset('// old bundle');
    });

    const ok = await new PluginUpdater(makePlugin()).installUpdate('5.99.7');
    expect(ok).toBe(false);
  });

  it('writes the downloaded bytes and succeeds only when the manifest is the new version', async () => {
    (requestUrl as jest.Mock).mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith('manifest.json')) {
        return asset('{"id":"realclaudian","version":"5.99.7"}');
      }
      return asset('// bundle 5.99.7');
    });

    const plugin = makePlugin();
    const ok = await new PluginUpdater(plugin).installUpdate('5.99.7');
    expect(ok).toBe(true);

    const dest = path.join(root, '.obsidian', 'plugins', 'realclaudian');
    expect(fs.readFileSync(path.join(dest, 'main.js'), 'utf8')).toBe('// bundle 5.99.7');
    expect(JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).version).toBe('5.99.7');
  });
});

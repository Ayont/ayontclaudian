import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readJsonFile, SerialJsonFileWriter, writeJsonFileAtomic } from '@/core/storage/atomicJsonFile';

describe('atomicJsonFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-atomic-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes JSON that reads back, creating missing folders', async () => {
    const target = path.join(dir, 'nested', 'state.json');

    await writeJsonFileAtomic(target, { openTabs: [{ tabId: 'a' }] });

    expect(await readJsonFile(target)).toEqual({ openTabs: [{ tabId: 'a' }] });
  });

  it('leaves no temp file behind after a write', async () => {
    const target = path.join(dir, 'state.json');

    await writeJsonFileAtomic(target, { ok: true });

    expect(await fs.readdir(dir)).toEqual(['state.json']);
  });

  it('keeps the previous file intact when the write fails before the rename', async () => {
    const target = path.join(dir, 'state.json');
    await writeJsonFileAtomic(target, { version: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeJsonFileAtomic(target, circular)).rejects.toThrow();

    expect(await readJsonFile(target)).toEqual({ version: 1 });
    expect(await fs.readdir(dir)).toEqual(['state.json']);
  });

  it('reads a missing, empty or truncated file as null', async () => {
    const empty = path.join(dir, 'empty.json');
    const truncated = path.join(dir, 'truncated.json');
    await fs.writeFile(empty, '');
    await fs.writeFile(truncated, '{"openTabs": [');

    expect(await readJsonFile(path.join(dir, 'missing.json'))).toBeNull();
    expect(await readJsonFile(empty)).toBeNull();
    expect(await readJsonFile(truncated)).toBeNull();
  });

  describe('SerialJsonFileWriter', () => {
    it('applies concurrent writes in call order, so the last call wins', async () => {
      const target = path.join(dir, 'state.json');
      const writer = new SerialJsonFileWriter(target);

      await Promise.all([writer.write({ n: 1 }), writer.write({ n: 2 }), writer.write({ n: 3 })]);

      expect(await readJsonFile(target)).toEqual({ n: 3 });
    });

    it('skips a write whose content matches the last one written', async () => {
      const target = path.join(dir, 'state.json');
      const writer = new SerialJsonFileWriter(target);
      await writer.write({ same: true });
      const { mtimeMs } = await fs.stat(target);
      await new Promise(resolve => setTimeout(resolve, 20));

      await writer.write({ same: true });

      expect((await fs.stat(target)).mtimeMs).toBe(mtimeMs);
    });

    it('treats loaded content as already written', async () => {
      const target = path.join(dir, 'state.json');
      const writer = new SerialJsonFileWriter(target);
      writer.markWritten({ loaded: true });

      await writer.write({ loaded: true });

      expect(await readJsonFile(target)).toBeNull();
    });

    it('keeps accepting writes after a failed one', async () => {
      const target = path.join(dir, 'state.json');
      const writer = new SerialJsonFileWriter(target);
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      await expect(writer.write(circular)).rejects.toThrow();
      await writer.write({ recovered: true });

      expect(await readJsonFile(target)).toEqual({ recovered: true });
    });
  });
});

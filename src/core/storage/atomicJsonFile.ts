import { promises as fs } from 'fs';
import * as path from 'path';

/** Reads a JSON file. A missing, empty or unparsable file reads as null. */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function writeTextFileAtomic(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporary, text, 'utf8');
    // rename replaces the target in one step: a reader sees the old file or the
    // new one, never a truncated half — which is what an in-place write leaves
    // behind when Obsidian quits in the middle of it.
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextFileAtomic(filePath, JSON.stringify(value, null, 2));
}

/**
 * One writer per file: writes run in call order and a write whose content
 * matches the last one on disk is skipped. Two shutdown paths saving the same
 * state then cost one write, and never race each other.
 */
export class SerialJsonFileWriter {
  private queue: Promise<void> = Promise.resolve();
  private lastWritten: string | null = null;

  constructor(private readonly filePath: string) {}

  write(value: unknown): Promise<void> {
    let text: string;
    try {
      text = JSON.stringify(value, null, 2);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const run = async (): Promise<void> => {
      if (text === this.lastWritten) return;
      await writeTextFileAtomic(this.filePath, text);
      this.lastWritten = text;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Records content that is already on disk, e.g. right after loading it. */
  markWritten(value: unknown): void {
    try {
      this.lastWritten = JSON.stringify(value, null, 2);
    } catch {
      this.lastWritten = null;
    }
  }
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ChatMessage } from '../../../core/types';

export function getClineDataDir(): string {
  const override = process.env.CLINE_DATA_DIR?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), '.cline', 'data');
}

export function getClineSessionDir(sessionId: string): string {
  return path.join(getClineDataDir(), 'sessions', sessionId);
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function readClineSessionMessages(sessionId: string): ChatMessage[] {
  const dir = getClineSessionDir(sessionId);
  const filePath = path.join(dir, `${sessionId}.messages.json`);
  const parsed = readJsonFile(filePath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  const rawMessages = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  const messages: ChatMessage[] = [];
  for (const entry of rawMessages) {
    const message = toChatMessage(entry);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

export function clineSessionExists(sessionId: string): boolean {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return false;
  }
  const filePath = path.join(getClineSessionDir(trimmed), `${trimmed}.messages.json`);
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function deleteClineSessionDir(sessionId: string): void {
  const dir = getClineSessionDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

function toChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
  if (!role) {
    return null;
  }
  const text = extractText(record.content);
  if (!text.trim()) {
    return null;
  }
  return {
    id: typeof record.id === 'string' ? record.id : `cline-${role}-${messagesSafeId()}`,
    role,
    content: stripUserInputTags(text),
    timestamp: typeof record.ts === 'number' ? record.ts : Date.now(),
  };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      if (typeof block === 'string') {
        return block;
      }
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        const record = block as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      }
      return '';
    })
    .join('');
}

function stripUserInputTags(text: string): string {
  return text.replace(/<\/?user_input\b[^>]*>/g, '').trim();
}

function messagesSafeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

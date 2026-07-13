import type { Vault } from 'obsidian';

import type { ChatMessage } from '../../../core/types';

export const RESPONSE_EXPORT_FOLDER = 'Claudian/Antworten';

function cleanTitleSource(content: string): string {
  const firstUsefulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('```')) ?? 'Claudian Antwort';

  return firstUsefulLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`~[\]<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildResponseExportBaseName(content: string, timestamp: number): string {
  const title = cleanTitleSource(content)
    .replace(/[\\/:*?"|]/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 64)
    .trim() || 'Claudian Antwort';
  const date = new Date(timestamp).toISOString().slice(0, 10);
  return `${date} - ${title}`;
}

export function buildResponseExportMarkdown(message: ChatMessage): string {
  const provider = message.agentProvider ?? 'unbekannt';
  const model = message.agentModel ?? 'unbekannt';
  const created = new Date(message.timestamp).toISOString();
  return [
    '---',
    'tags:',
    '  - claudian',
    '  - ai-antwort',
    `provider: ${JSON.stringify(provider)}`,
    `model: ${JSON.stringify(model)}`,
    `erstellt: ${JSON.stringify(created)}`,
    '---',
    '',
    message.content.trim(),
    '',
  ].join('\n');
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  let current = '';
  for (const segment of folder.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    if (!await vault.adapter.exists(current)) {
      await vault.createFolder(current);
    }
  }
}

/** Writes an assistant response to a visible, Obsidian-indexed note without overwriting. */
export async function exportAssistantResponse(vault: Vault, message: ChatMessage): Promise<string> {
  await ensureFolder(vault, RESPONSE_EXPORT_FOLDER);
  const baseName = buildResponseExportBaseName(message.content, message.timestamp);
  let suffix = 0;
  let path = `${RESPONSE_EXPORT_FOLDER}/${baseName}.md`;
  while (await vault.adapter.exists(path)) {
    suffix += 1;
    path = `${RESPONSE_EXPORT_FOLDER}/${baseName} (${suffix}).md`;
  }
  await vault.create(path, buildResponseExportMarkdown(message));
  return path;
}

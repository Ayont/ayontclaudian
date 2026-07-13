import type { ChatMessage } from '@/core/types';
import {
  buildResponseExportBaseName,
  buildResponseExportMarkdown,
  exportAssistantResponse,
} from '@/features/chat/services/ResponseExportService';

const message: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: '# Netzwerk prüfen\n\nBitte zuerst die Route kontrollieren.',
  timestamp: Date.parse('2026-07-13T10:15:00.000Z'),
  agentProvider: 'codex',
  agentModel: 'gpt-5.6-terra',
};

describe('ResponseExportService', () => {
  it('builds a safe, descriptive filename from the first useful line', () => {
    expect(buildResponseExportBaseName(message.content, message.timestamp))
      .toBe('2026-07-13 - Netzwerk prüfen');
    expect(buildResponseExportBaseName('# A/B: Test?', message.timestamp))
      .toBe('2026-07-13 - A-B- Test-');
  });

  it('creates Obsidian-native frontmatter and preserves the response markdown', () => {
    const markdown = buildResponseExportMarkdown(message);
    expect(markdown).toContain('tags:\n  - claudian\n  - ai-antwort');
    expect(markdown).toContain('provider: "codex"');
    expect(markdown).toContain('model: "gpt-5.6-terra"');
    expect(markdown).toContain(message.content);
  });

  it('creates folders and never overwrites an existing response note', async () => {
    const existing = new Set(['Claudian', 'Claudian/Antworten', 'Claudian/Antworten/2026-07-13 - Netzwerk prüfen.md']);
    const vault = {
      adapter: { exists: jest.fn(async (path: string) => existing.has(path)) },
      createFolder: jest.fn(async (path: string) => { existing.add(path); }),
      create: jest.fn(async (path: string) => ({ path })),
    } as any;

    const path = await exportAssistantResponse(vault, message);

    expect(path).toBe('Claudian/Antworten/2026-07-13 - Netzwerk prüfen (1).md');
    expect(vault.create).toHaveBeenCalledWith(path, expect.stringContaining(message.content));
  });
});

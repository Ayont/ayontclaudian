import { formatConversationHtml } from '@/features/chat/export/ConversationHtmlExporter';

describe('ConversationHtmlExporter', () => {
  it('creates a self-contained escaped conversation export', () => {
    const html = formatConversationHtml({
      id: 'c1', providerId: 'codex', title: '<Test>', createdAt: 1, updatedAt: 2,
      sessionId: null,
      messages: [
        { id: 'u', role: 'user', content: 'Hallo <script>', timestamp: 1 },
        { id: 'a', role: 'assistant', content: 'Antwort', timestamp: 2, agentLabel: 'Codex · Terra' },
      ],
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('&lt;Test&gt;');
    expect(html).toContain('Hallo &lt;script&gt;');
    expect(html).not.toContain('Hallo <script>');
    expect(html).toContain('Codex · Terra');
  });

  it('exports the typed prompt of history-loaded messages without envelopes', () => {
    const html = formatConversationHtml({
      id: 'c1', providerId: 'claude', title: 'T', createdAt: 1, updatedAt: 2, sessionId: null,
      messages: [
        {
          id: 'u',
          role: 'user',
          content: '<standing_goal>\nGoal\n</standing_goal>\n<vault_context>\nRAG\n</vault_context>\nFrage?\n\n<current_note>\na.md\n</current_note>',
          timestamp: 1,
        },
        { id: 'a', role: 'assistant', content: '', contentBlocks: [{ type: 'text', content: 'Blockantwort' }], timestamp: 2 },
      ],
    });

    expect(html).toContain('Frage?');
    expect(html).toContain('Blockantwort');
    expect(html).not.toMatch(/standing_goal|vault_context|current_note|RAG/);
  });

  it('skips a replaced answer and its prompt', () => {
    const html = formatConversationHtml({
      id: 'c1', providerId: 'codex', title: 'T', createdAt: 1, updatedAt: 2, sessionId: null,
      messages: [
        { id: 'u1', role: 'user', content: 'Frage', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Alt', timestamp: 2, isSuperseded: true },
        { id: 'u2', role: 'user', content: 'Frage', timestamp: 3 },
        { id: 'a2', role: 'assistant', content: 'Neu', timestamp: 4 },
      ],
    });

    expect(html).not.toContain('>Alt<');
    expect(html).toContain('Neu');
    expect(html.match(/class="message user"/g)).toHaveLength(1);
  });
});

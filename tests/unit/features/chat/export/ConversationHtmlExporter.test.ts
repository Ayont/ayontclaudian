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
});

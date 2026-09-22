import {
  buildConversationSearchIndex,
  SEARCH_INDEX_TEXT_LIMIT,
} from '@/core/conversation/conversationSearchIndex';
import type { ChatMessage } from '@/core/types';

const user = (content: string, displayContent?: string): ChatMessage => ({
  id: `u-${content.slice(0, 8)}`,
  role: 'user',
  content,
  ...(displayContent ? { displayContent } : {}),
  timestamp: 1,
});

const assistant = (content: string): ChatMessage => ({
  id: `a-${content.slice(0, 8)}`,
  role: 'assistant',
  content,
  timestamp: 2,
});

describe('buildConversationSearchIndex', () => {
  it('takes the preview from the first prompt without Claudian\'s context envelopes', () => {
    const index = buildConversationSearchIndex([
      user('<vault_context>\nRelevant vault notes: …\n</vault_context>\n\nWarum schlägt der Fax-Versand bei C. Beuthel fehl?'),
      assistant('Der Fehler kommt vom SIP-Trunk.'),
    ]);

    expect(index?.preview).toBe('Warum schlägt der Fax-Versand bei C. Beuthel fehl?');
  });

  it('prefers the stored display text of a prompt', () => {
    const index = buildConversationSearchIndex([user('raw transport text', 'Was der Nutzer sah')]);

    expect(index?.preview).toBe('Was der Nutzer sah');
  });

  it('keeps the latest prompt separately so the row can show where the chat stopped', () => {
    const index = buildConversationSearchIndex([
      user('Firewall-Regeln für CERTUSS prüfen'),
      assistant('Erledigt.'),
      user('Jetzt noch das VPN-Profil exportieren'),
    ]);

    expect(index?.preview).toBe('Firewall-Regeln für CERTUSS prüfen');
    expect(index?.lastPrompt).toBe('Jetzt noch das VPN-Profil exportieren');
  });

  it('indexes prompts and the opening of each reply for content search', () => {
    const index = buildConversationSearchIndex([
      user('Welche Ports braucht 3CX?'),
      assistant('Für 3CX brauchst du 5060 UDP für SIP und 9000–10999 für RTP.'),
    ]);

    expect(index?.text).toContain('Welche Ports braucht 3CX?');
    expect(index?.text).toContain('5060 UDP');
  });

  it('collapses whitespace and bounds the indexed text', () => {
    const long = 'Wort '.repeat(5000);
    const index = buildConversationSearchIndex([user(`Zeile 1\n\n   Zeile 2`), assistant(long)]);

    expect(index?.preview).toBe('Zeile 1 Zeile 2');
    expect(index!.text.length).toBeLessThanOrEqual(SEARCH_INDEX_TEXT_LIMIT);
  });

  it('returns nothing for a chat with no readable text', () => {
    expect(buildConversationSearchIndex([])).toBeUndefined();
    expect(buildConversationSearchIndex([user('<vault_context>nur Kontext</vault_context>')])).toBeUndefined();
  });
});

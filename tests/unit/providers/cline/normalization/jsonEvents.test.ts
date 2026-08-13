import { extractClineJsonText } from '@/providers/cline/normalization/jsonEvents';

describe('extractClineJsonText', () => {
  it('joins documented agent_event text lines', () => {
    const buffer = [
      '{"type":"agent_event","event":{"text":"Hello "}}',
      '{"type":"agent_event","event":{"text":"world"}}',
      'not-json',
    ].join('\n');
    expect(extractClineJsonText(buffer)).toBe('Hello world');
  });
});

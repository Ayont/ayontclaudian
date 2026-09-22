import { localToolInstructions, parseLocalProposal } from '../../../../src/providers/desktopBridge/localTools';

describe('local proposal framing', () => {
  it('separates model JSON from approved Claudian execution within the continuation budget', () => {
    const text = localToolInstructions('12345678-1234-1234-1234-123456789012');
    expect(text).toContain('Claudian');
    expect(text).toContain('not permission');
    expect(text).toContain('may decline');
    expect(text.length + 1100 + 130).toBeLessThanOrEqual(2000);
    const json = text.match(/\{"local_tool"[^\n]+?\}/)![0];
    expect(parseLocalProposal(json, '12345678-1234-1234-1234-123456789012')).toEqual({ local_tool: 'read', nonce: '12345678-1234-1234-1234-123456789012', path: 'relative.txt' });
  });
});

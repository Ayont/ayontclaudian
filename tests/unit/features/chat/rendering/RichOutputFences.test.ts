import type { ContentBlock } from '@/core/types';
import {
  canonicalizeNetworkMapFrames,
  coalesceRichOutputBlocks,
  inspectRichOutput,
  prepareRichOutputMarkdown,
} from '@/features/chat/rendering/RichOutputFences';

describe('RichOutputFences', () => {
  it('recognizes a document fence that only closes in a later text segment', () => {
    const open = '```claudian-document\n---\ntitle: Einsatzplan\n---\n# Einsatzplan';

    expect(inspectRichOutput(open)).toMatchObject({
      surface: 'live-document',
      closed: false,
    });
    expect(inspectRichOutput(`${open}\n\n## Ablauf\nText\n\`\`\``)).toMatchObject({
      surface: 'live-document',
      closed: true,
    });
  });

  it.each([
    ['live-document', 'claudian-document'],
    ['email', 'claudian-email'],
  ] as const)('wraps provider markdown for an explicit %s target', (surface, language) => {
    expect(prepareRichOutputMarkdown('# Ergebnis\n\nDirekt nutzbar.', surface)).toBe(
      `\`\`\`${language}\n# Ergebnis\n\nDirekt nutzbar.\n\`\`\``,
    );
  });

  it('coalesces an open fence across a tool block without moving the tool before it', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', content: '```claudian-document\n# Plan\nErster Teil' },
      { type: 'tool_use', toolId: 'tool-1' },
      { type: 'text', content: '\nZweiter Teil\n```\n\nDanach.' },
    ];

    expect(coalesceRichOutputBlocks(blocks)).toEqual([
      {
        type: 'text',
        content: '```claudian-document\n# Plan\nErster Teil\nZweiter Teil\n```',
        outputSurface: 'live-document',
      },
      { type: 'tool_use', toolId: 'tool-1' },
      { type: 'text', content: '\n\nDanach.' },
    ]);
  });

  it('keeps only the latest progressive network-map frame', () => {
    const first = '```network-map\nInternet --> Firewall\n```';
    const second = '```network-map\nInternet --> Firewall\nFirewall --> LAN\n```';
    const canonical = canonicalizeNetworkMapFrames(`${first}\n\n${second}`);

    expect(canonical.match(/```network-map/g)).toHaveLength(1);
    expect(canonical).not.toContain('Internet --> Firewall\n```\n\n```network-map');
    expect(canonical).toContain('Firewall --> LAN');
  });
});

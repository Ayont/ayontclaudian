import type { ChatTurnRequest } from '@/core/runtime/types';
import {
  buildHermesPromptBlocks,
  buildHermesPromptText,
  prependHermesVaultPrompt,
} from '@/providers/hermes/runtime/buildHermesPrompt';

function createRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return { text: 'Fasse die Notiz zusammen.', ...overrides } as ChatTurnRequest;
}

describe('buildHermesPromptText', () => {
  it('passes the plain text through untouched', () => {
    expect(buildHermesPromptText(createRequest())).toBe('Fasse die Notiz zusammen.');
  });

  it('appends the current note when the chat carries one', () => {
    const prompt = buildHermesPromptText(createRequest({ currentNotePath: 'Notes/Today.md' }));

    expect(prompt).toContain('Fasse die Notiz zusammen.');
    expect(prompt).toContain('Notes/Today.md');
  });
});

describe('prependHermesVaultPrompt', () => {
  it('wraps the vault prompt in a fence the history reader can strip again', () => {
    expect(prependHermesVaultPrompt('Hallo', '  Vault rules  ')).toBe(
      '<claudian-vault-instructions>\nVault rules\n</claudian-vault-instructions>\n\nHallo',
    );
  });

  it('leaves the prompt alone when there is nothing to inject', () => {
    expect(prependHermesVaultPrompt('Hallo', '   ')).toBe('Hallo');
  });
});

describe('buildHermesPromptBlocks', () => {
  it('sends one text block when no vault prompt is requested', () => {
    expect(buildHermesPromptBlocks({ request: createRequest() })).toEqual([
      { type: 'text', text: 'Fasse die Notiz zusammen.' },
    ]);
  });

  it('folds the vault prompt into the leading text block', () => {
    const blocks = buildHermesPromptBlocks({
      request: createRequest(),
      vaultPrompt: 'Vault rules',
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text' });
    expect((blocks[0] as { text: string }).text).toContain('<claudian-vault-instructions>');
    expect((blocks[0] as { text: string }).text).toContain('Fasse die Notiz zusammen.');
  });

  it('adds a native image block and keeps the staged path as a fallback', () => {
    const blocks = buildHermesPromptBlocks({
      request: createRequest({
        images: [{ data: 'BASE64', id: 'img-1', mediaType: 'image/png' }],
      } as Partial<ChatTurnRequest>),
    });

    expect(blocks).toHaveLength(2);
    expect((blocks[0] as { text: string }).text).toContain('.claudian/staging/images/img-1.png');
    expect(blocks[1]).toEqual({ data: 'BASE64', mimeType: 'image/png', type: 'image' });
  });

  it('skips images that carry no pixels but still references the staged file', () => {
    const blocks = buildHermesPromptBlocks({
      request: createRequest({
        images: [{ id: 'img-1', mediaType: 'image/png' }],
      } as Partial<ChatTurnRequest>),
    });

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toContain('.claudian/staging/images/img-1.png');
  });
});

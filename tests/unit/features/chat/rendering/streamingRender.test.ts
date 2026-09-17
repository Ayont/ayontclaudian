import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { MarkdownRenderer } from 'obsidian';

import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  renderStoredToolCall: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createRenderer() {
  const plugin = { app: {}, settings: { mediaFolder: '' } };
  const component = { registerDomEvent: jest.fn(), register: jest.fn() };
  return new MessageRenderer(
    plugin as any,
    component as any,
    createMockEl(),
    undefined,
    undefined,
    { providerId: 'claude', reasoningControl: 'effort' } as any,
  );
}

/** Total Markdown characters handed to the Obsidian renderer so far. */
function renderedCharTotal(): number {
  return (MarkdownRenderer.render as jest.Mock).mock.calls
    .reduce((sum, call) => sum + String(call[1] ?? '').length, 0);
}

/**
 * One settled paragraph followed by a blank line — a safe split boundary.
 * Sized past the renderer's 2 000-character engagement threshold so the
 * incremental path is actually exercised.
 */
const PARAGRAPH = `${'Ein abgeschlossener Absatz mit genug Text. '.repeat(60)}\n\n`;

describe('streaming render cost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders settled Markdown once instead of on every frame', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    // Ten frames, each adding a whole settled paragraph.
    let content = '';
    for (let frame = 0; frame < 10; frame++) {
      content += PARAGRAPH;
      await renderer.renderStreamingContent(el as any, content);
    }

    // Re-rendering everything every frame costs ~sum(1..10) paragraphs.
    const wholeAnswerEachFrame = PARAGRAPH.length * (10 * 11) / 2;
    expect(renderedCharTotal()).toBeLessThan(wholeAnswerEachFrame / 2);
  });

  it('still renders the complete answer — nothing is dropped by the split', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    const content = `${PARAGRAPH}${PARAGRAPH}Letzter, noch laufender Absatz.`;
    await renderer.renderStreamingContent(el as any, content);

    const seen = (MarkdownRenderer.render as jest.Mock).mock.calls
      .map((call) => String(call[1] ?? ''))
      .join('');
    expect(seen).toContain('Letzter, noch laufender Absatz.');
    expect(seen.replace(/\s+/g, ' ')).toContain('Ein abgeschlossener Absatz mit genug Text.');
  });

  it('leaves short answers on the plain whole-content path', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    await renderer.renderStreamingContent(el as any, 'Kurze Antwort ohne Umbruch.');

    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
    expect(String((MarkdownRenderer.render as jest.Mock).mock.calls[0][1]))
      .toBe('Kurze Antwort ohne Umbruch.');
  });

  it('collapses the split into one canonical render when the stream ends', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    const content = `${PARAGRAPH}${PARAGRAPH}Schluss.`;
    await renderer.renderStreamingContent(el as any, content);
    jest.clearAllMocks();

    await renderer.finalizeStreamingContent(el as any, content);

    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
    expect(String((MarkdownRenderer.render as jest.Mock).mock.calls[0][1])).toBe(content);
  });

  it('finalizing an unsplit element does not render a second time', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    await renderer.renderStreamingContent(el as any, 'Kurz.');
    jest.clearAllMocks();

    await renderer.finalizeStreamingContent(el as any, 'Kurz.');

    expect(MarkdownRenderer.render).not.toHaveBeenCalled();
  });

  it('rebuilds from scratch when the streamed prefix is rewritten', async () => {
    const renderer = createRenderer();
    const el = createMockEl();

    await renderer.renderStreamingContent(el as any, `${PARAGRAPH}${PARAGRAPH}Erst so.`);
    jest.clearAllMocks();

    const rewritten = 'Komplett andere Antwort nach einem Retry.';
    await renderer.renderStreamingContent(el as any, rewritten);

    expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
    expect(String((MarkdownRenderer.render as jest.Mock).mock.calls[0][1])).toBe(rewritten);
  });
});

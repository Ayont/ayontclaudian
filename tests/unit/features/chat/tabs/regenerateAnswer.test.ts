import { Notice } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  findLastAnswerId,
  planRegeneration,
  regenerateTabAnswer,
} from '@/features/chat/tabs/regenerateAnswer';

const mockNotice = Notice as unknown as jest.Mock;

function msg(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, timestamp: 1, ...extra };
}

function bytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

describe('planRegeneration', () => {
  const rewindable = [
    msg('u0', 'user', 'Erste Frage', { userMessageId: 'uu0' }),
    msg('a0', 'assistant', 'Erste Antwort', { assistantMessageId: 'aa0' }),
    msg('u1', 'user', 'Zweite Frage', { userMessageId: 'uu1' }),
    msg('a1', 'assistant', 'Zweite Antwort', { assistantMessageId: 'aa1' }),
  ];

  it('replaces the latest answer in place when the provider can rewind', () => {
    const decision = planRegeneration(rewindable, 'a1', { canRewind: true });

    expect(decision).toMatchObject({
      ok: true,
      plan: { strategy: 'rewind', prompt: 'Zweite Frage', answerIds: ['a1'], userMessage: { id: 'u1' } },
    });
  });

  it('appends a new turn when the provider cannot rewind', () => {
    expect(planRegeneration(rewindable, 'a1', { canRewind: false }))
      .toMatchObject({ ok: true, plan: { strategy: 'supersede', answerIds: ['a1'] } });
  });

  it('never rewinds past later turns: an older answer gets a new turn instead', () => {
    expect(planRegeneration(rewindable, 'a0', { canRewind: true }))
      .toMatchObject({ ok: true, plan: { strategy: 'supersede', prompt: 'Erste Frage' } });
  });

  it('needs a checkpoint before the prompt to rewind, so the first turn is superseded', () => {
    const firstTurn = rewindable.slice(0, 2);

    expect(planRegeneration(firstTurn, 'a0', { canRewind: true }))
      .toMatchObject({ ok: true, plan: { strategy: 'supersede' } });
  });

  it('collects every answer message of the turn, across interrupt markers', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Teil 1'),
      msg('i1', 'user', '[Request interrupted by user]', { isInterrupt: true }),
      msg('a2', 'assistant', 'Teil 2'),
    ];

    expect(planRegeneration(messages, 'a1', { canRewind: false }))
      .toMatchObject({ ok: true, plan: { answerIds: ['a1', 'a2'] } });
  });

  it('resends what the user typed, not the transport envelopes of a history-loaded prompt', () => {
    const messages = [
      msg('u1', 'user', '<vault_context>\nRAG\n</vault_context>\nFrage\n\n<current_note>\na.md\n</current_note>'),
      msg('a1', 'assistant', 'Antwort'),
    ];

    expect(planRegeneration(messages, 'a1', { canRewind: false }))
      .toMatchObject({ ok: true, plan: { prompt: 'Frage' } });
  });

  it('sends no text for an attachment-only turn', () => {
    const messages = [
      msg('u1', 'user', '@a.pdf', { displayContent: '📎 a.pdf', attachments: [{ name: 'a.pdf', relPath: 'a.pdf' }] }),
      msg('a1', 'assistant', 'Antwort'),
    ];

    expect(planRegeneration(messages, 'a1', { canRewind: false }))
      .toMatchObject({ ok: true, plan: { prompt: '' } });
  });

  it('keeps a specialized output surface of the replaced answer', () => {
    const messages = [msg('u1', 'user', 'Mail'), msg('a1', 'assistant', 'x', { outputSurface: 'email' })];

    expect(planRegeneration(messages, 'a1', { canRewind: false }))
      .toMatchObject({ ok: true, plan: { outputSurface: 'email' } });
  });

  it('refuses answers it cannot regenerate', () => {
    expect(planRegeneration([msg('a1', 'assistant', 'x')], 'a1', { canRewind: false }).ok).toBe(false);
    expect(planRegeneration([msg('u1', 'user', 'x')], 'missing', { canRewind: false }).ok).toBe(false);
    expect(planRegeneration(
      [msg('u1', 'user', 'x'), msg('a1', 'assistant', 'y', { isSuperseded: true })],
      'a1',
      { canRewind: false },
    ).ok).toBe(false);
  });
});

describe('findLastAnswerId', () => {
  it('returns the newest answer that is still current', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Alt', { isSuperseded: true }),
      msg('u2', 'user', 'Frage'),
      msg('a2', 'assistant', 'Neu'),
    ];

    expect(findLastAnswerId(messages, { isStreaming: false })).toBe('a2');
  });

  it('skips the turn that is still streaming', () => {
    const messages = [
      msg('u1', 'user', 'Frage'),
      msg('a1', 'assistant', 'Fertig'),
      msg('u2', 'user', 'Weiter'),
      msg('a2', 'assistant', 'Halb'),
    ];

    expect(findLastAnswerId(messages, { isStreaming: true })).toBe('a1');
  });

  it('returns null without an answer', () => {
    expect(findLastAnswerId([msg('u1', 'user', 'Frage')], { isStreaming: false })).toBeNull();
  });
});

interface FakeTabOptions {
  messages: ChatMessage[];
  supportsRewind?: boolean;
  startsTurn?: boolean;
  rewindResult?: boolean;
}

function createFakeTab(options: FakeTabOptions) {
  const state = new ChatState();
  state.messages = options.messages;
  const inputEl = { value: 'ungesendeter Entwurf', focus: jest.fn() };
  const snapshots: ChatMessage[][] = [];
  const sendMessage = jest.fn(async () => {
    snapshots.push(state.messages);
    if (options.startsTurn !== false) {
      state.addMessage(msg('new-u', 'user', 'resent'));
      state.addMessage(msg('new-a', 'assistant', 'neu'));
    }
  });
  const rewind = jest.fn(async (userId: string) => {
    if (options.rewindResult === false) return false;
    state.truncateAt(userId);
    return true;
  });
  const setMessagesSuperseded = jest.fn();
  const tab = {
    id: 'tab-1',
    providerId: 'claude',
    conversationId: 'conv-1',
    lifecycleState: 'bound_active',
    draftModel: null,
    service: {
      providerId: 'claude',
      getCapabilities: () => ({ supportsRewind: options.supportsRewind === true }),
    },
    state,
    dom: { inputEl },
    controllers: {
      inputController: { sendMessage },
      conversationController: { rewind },
    },
    renderer: { setMessagesSuperseded },
  };
  return { tab, state, inputEl, sendMessage, rewind, setMessagesSuperseded, snapshots };
}

function createPlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: {},
    getConversationSync: jest.fn().mockReturnValue({ providerId: 'claude' }),
    imageStagingService: { loadImages: jest.fn().mockResolvedValue(new Map()) },
    app: { vault: { adapter: { readBinary: jest.fn().mockRejectedValue(new Error('missing')) } } },
    ...overrides,
  };
}

describe('regenerateTabAnswer', () => {
  beforeEach(() => {
    mockNotice.mockClear();
  });

  it('resends the original prompt through the send path and never touches the draft', async () => {
    const fake = createFakeTab({ messages: [msg('u1', 'user', 'Frage'), msg('a1', 'assistant', 'Antwort')] });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.sendMessage).toHaveBeenCalledWith({
      content: 'Frage',
      images: undefined,
      attachments: [],
      outputSurface: undefined,
      editorContextOverride: null,
      browserContextOverride: null,
      canvasContextOverride: null,
    });
    expect(fake.inputEl.value).toBe('ungesendeter Entwurf');
  });

  it('collapses the replaced answer before the new turn and keeps it collapsed', async () => {
    const fake = createFakeTab({ messages: [msg('u1', 'user', 'Frage'), msg('a1', 'assistant', 'Antwort')] });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.setMessagesSuperseded).toHaveBeenCalledWith(['a1'], true);
    expect(fake.snapshots[0].find((m) => m.id === 'a1')?.isSuperseded).toBe(true);
    expect(fake.state.messages.find((m) => m.id === 'a1')?.isSuperseded).toBe(true);
    expect(fake.setMessagesSuperseded).not.toHaveBeenCalledWith(['a1'], false);
  });

  it('restores the answer when the resend never started', async () => {
    const fake = createFakeTab({
      messages: [msg('u1', 'user', 'Frage'), msg('a1', 'assistant', 'Antwort')],
      startsTurn: false,
    });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.state.messages.find((m) => m.id === 'a1')?.isSuperseded).toBeUndefined();
    expect(fake.setMessagesSuperseded).toHaveBeenLastCalledWith(['a1'], false);
  });

  it('carries images (reloaded from the archive) and re-profiled tables', async () => {
    const fake = createFakeTab({
      messages: [
        msg('u1', 'user', 'Werte aus', {
          images: [{ id: 'img1', name: 'a.png', mediaType: 'image/png', data: '', size: 3, source: 'paste' }],
          attachments: [{ name: 'k.csv', relPath: '.claudian/attachments/k.csv', table: { rows: 1, columns: 2 } }],
        }),
        msg('a1', 'assistant', 'Antwort'),
      ],
    });
    const plugin = createPlugin({
      imageStagingService: {
        loadImages: jest.fn().mockResolvedValue(new Map([[
          'img1',
          { id: 'img1', name: 'a.png', mediaType: 'image/png', data: 'QUJD', size: 3, source: 'paste' },
        ]])),
      },
      app: { vault: { adapter: { readBinary: jest.fn().mockResolvedValue(bytes('a;b\n1;2\n')) } } },
    });

    await regenerateTabAnswer(fake.tab as any, plugin as any, 'a1');

    const request = (fake.sendMessage.mock.calls[0] as unknown[])[0] as any;
    expect(request.images).toEqual([expect.objectContaining({ id: 'img1', data: 'QUJD' })]);
    expect(request.attachments[0]).toMatchObject({ name: 'k.csv', relPath: '.claudian/attachments/k.csv' });
    expect(request.attachments[0].table.delimiter).toBe(';');
  });

  it('stops before changing anything when an image is gone', async () => {
    const fake = createFakeTab({
      messages: [
        msg('u1', 'user', 'Was ist das?', {
          images: [{ id: 'img1', name: 'a.png', mediaType: 'image/png', data: '', size: 3, source: 'paste' }],
        }),
        msg('a1', 'assistant', 'Antwort'),
      ],
    });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.sendMessage).not.toHaveBeenCalled();
    expect(fake.setMessagesSuperseded).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('Bild'));
  });

  it('asks about the same selection the original prompt carried', async () => {
    const fake = createFakeTab({
      messages: [
        msg('u1', 'user', 'Erkläre das\n\n<editor_selection path="a.md" lines="3-3">\nZeile\n</editor_selection>', {
          displayContent: 'Erkläre das',
        }),
        msg('a1', 'assistant', 'Antwort'),
      ],
    });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Erkläre das',
      editorContextOverride: { notePath: 'a.md', mode: 'selection', selectedText: 'Zeile', lineCount: 1, startLine: 3 },
    }));
  });

  it('rewinds and resends in place when the runtime can rewind', async () => {
    const fake = createFakeTab({
      supportsRewind: true,
      messages: [
        msg('u0', 'user', 'Erste', { userMessageId: 'uu0' }),
        msg('a0', 'assistant', 'A0', { assistantMessageId: 'aa0' }),
        msg('u1', 'user', 'Zweite', { userMessageId: 'uu1' }),
        msg('a1', 'assistant', 'A1', { assistantMessageId: 'aa1' }),
      ],
    });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.rewind).toHaveBeenCalledWith('u1', 'conversation', { silent: true });
    expect(fake.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Zweite' }));
    expect(fake.setMessagesSuperseded).not.toHaveBeenCalled();
    expect(fake.state.messages.map((m) => m.id)).toEqual(['u0', 'a0', 'new-u', 'new-a']);
  });

  it('does not resend when the rewind was refused', async () => {
    const fake = createFakeTab({
      supportsRewind: true,
      rewindResult: false,
      messages: [
        msg('u0', 'user', 'Erste', { userMessageId: 'uu0' }),
        msg('a0', 'assistant', 'A0', { assistantMessageId: 'aa0' }),
        msg('u1', 'user', 'Zweite', { userMessageId: 'uu1' }),
        msg('a1', 'assistant', 'A1', { assistantMessageId: 'aa1' }),
      ],
    });

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it('checks the token budget before rewinding away the old answer', async () => {
    const fake = createFakeTab({
      supportsRewind: true,
      messages: [
        msg('u0', 'user', 'Erste', { userMessageId: 'uu0' }),
        msg('a0', 'assistant', 'A0', { assistantMessageId: 'aa0' }),
        msg('u1', 'user', 'Zweite', { userMessageId: 'uu1' }),
        msg('a1', 'assistant', 'A1', { assistantMessageId: 'aa1' }),
      ],
    });
    const plugin = createPlugin({
      tokenBudgetTracker: { checkBudget: () => ({ ok: false, reason: 'Tagesbudget erreicht.' }) },
    });

    await regenerateTabAnswer(fake.tab as any, plugin as any, 'a1');

    expect(fake.rewind).not.toHaveBeenCalled();
    expect(fake.sendMessage).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledWith('Tagesbudget erreicht.');
  });

  it('refuses while an answer is streaming', async () => {
    const fake = createFakeTab({ messages: [msg('u1', 'user', 'Frage'), msg('a1', 'assistant', 'Antwort')] });
    fake.state.isStreaming = true;

    await regenerateTabAnswer(fake.tab as any, createPlugin() as any, 'a1');

    expect(fake.sendMessage).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledWith('Es läuft bereits eine Antwort — bitte warten oder abbrechen.');
  });
});

import {
  buildToolInput,
  canonicalToolName,
  cleanToolContent,
  decodeAgyArg,
  humanizeToolType,
  isAssistantTextEvent,
  isIgnorableEvent,
  isSubagentEvent,
  isToolErrorStatus,
  isToolEvent,
  isToolTerminalStatus,
  parsePlannerToolCalls,
  parseTranscript,
  parseTranscriptLine,
  stripAgyTrailingRecap,
  unwrapUserRequest,
} from '@/providers/antigravity/normalization/transcript';
import {
  createAntigravityTailState,
  mapTranscriptEventToChunks,
  transcriptToChatMessages,
} from '@/providers/antigravity/normalization/transcriptMapping';

const USER_LINE = JSON.stringify({
  step_index: 0,
  source: 'USER_EXPLICIT',
  type: 'USER_INPUT',
  status: 'DONE',
  created_at: '2026-05-20T11:38:18Z',
  content: '<USER_REQUEST>\nhi there\n</USER_REQUEST>\nextra metadata',
});
const HISTORY_LINE = JSON.stringify({
  step_index: 1,
  source: 'SYSTEM',
  type: 'CONVERSATION_HISTORY',
  status: 'DONE',
});
const MODEL_LINE = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  created_at: '2026-05-20T11:38:20Z',
  content: 'Hello! I am Antigravity.',
});
const SYSTEM_MESSAGE_LINE = JSON.stringify({
  step_index: 7,
  source: 'SYSTEM',
  type: 'SYSTEM_MESSAGE',
  status: 'DONE',
  content: 'internal bookkeeping the chat must not show',
});

// Real agy v1.0.3 tool shape: one MODEL step that grows RUNNING -> DONE, with
// the formatted result baked into `content` (no separate tool_input/result).
const RUN_RUNNING_LINE = JSON.stringify({
  step_index: 3,
  source: 'MODEL',
  type: 'RUN_COMMAND',
  status: 'RUNNING',
  content: '',
});
const RUN_DONE_LINE = JSON.stringify({
  step_index: 3,
  source: 'MODEL',
  type: 'RUN_COMMAND',
  status: 'DONE',
  content: 'Created At: 2026-05-20T11:38:25Z\nCompleted At: 2026-05-20T11:38:26Z\n\n\t\t\t\tOutput:\n\t\t\t\ttotal 4',
});
const VIEW_DONE_LINE = JSON.stringify({
  step_index: 4,
  source: 'MODEL',
  type: 'VIEW_FILE',
  status: 'DONE',
  created_at: '2026-05-20T11:38:30Z',
  content:
    'Created At: 2026-05-20T11:38:30Z\nCompleted At: 2026-05-20T11:38:30Z\nFile Path: `file:///vault/notes/a.md`\nTotal Lines: 1\n1: hello',
});
const GREP_ERROR_LINE = JSON.stringify({
  step_index: 5,
  source: 'MODEL',
  type: 'GREP_SEARCH',
  status: 'ERROR',
  content: 'Created At: 2026-05-20T11:38:35Z\nEncountered error in step execution: Grep command timed out',
});

describe('antigravity transcript parser', () => {
  it('parses a valid JSONL line into a normalized event', () => {
    const event = parseTranscriptLine(MODEL_LINE);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      stepIndex: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Hello! I am Antigravity.',
    });
  });

  it('returns null for blank or invalid lines', () => {
    expect(parseTranscriptLine('')).toBeNull();
    expect(parseTranscriptLine('   ')).toBeNull();
    expect(parseTranscriptLine('not json')).toBeNull();
    expect(parseTranscriptLine('{"no":"type"}')).toBeNull();
  });

  it('parses a multi-line buffer in order, skipping bad lines', () => {
    const buffer = [USER_LINE, 'garbage', HISTORY_LINE, MODEL_LINE, ''].join('\n');
    const events = parseTranscript(buffer);
    expect(events.map((e) => e.type)).toEqual([
      'USER_INPUT',
      'CONVERSATION_HISTORY',
      'PLANNER_RESPONSE',
    ]);
  });

  it('classifies planner, tool, and ignorable events', () => {
    const [user, , model] = parseTranscript([USER_LINE, HISTORY_LINE, MODEL_LINE].join('\n'));
    const run = parseTranscriptLine(RUN_DONE_LINE)!;
    const system = parseTranscriptLine(SYSTEM_MESSAGE_LINE)!;

    expect(isIgnorableEvent(user)).toBe(true);
    expect(isAssistantTextEvent(model)).toBe(true);
    expect(isToolEvent(model)).toBe(false);

    // A MODEL step that is not planner narration is a tool event.
    expect(isToolEvent(run)).toBe(true);
    expect(isAssistantTextEvent(run)).toBe(false);

    // SYSTEM-sourced bookkeeping is ignorable and never a tool.
    expect(isIgnorableEvent(system)).toBe(true);
    expect(isToolEvent(system)).toBe(false);
  });

  it('classifies tool status', () => {
    expect(isToolTerminalStatus('DONE')).toBe(true);
    expect(isToolTerminalStatus('ERROR')).toBe(true);
    expect(isToolTerminalStatus('RUNNING')).toBe(false);
    expect(isToolErrorStatus('ERROR')).toBe(true);
    expect(isToolErrorStatus('DONE')).toBe(false);
  });

  it('humanizes tool type names', () => {
    expect(humanizeToolType('RUN_COMMAND')).toBe('Run command');
    expect(humanizeToolType('VIEW_FILE')).toBe('View file');
    expect(humanizeToolType('FOO_BAR')).toBe('Foo bar');
  });

  it('cleans agy result headers and tab indentation', () => {
    const event = parseTranscriptLine(RUN_DONE_LINE)!;
    expect(cleanToolContent(event.content)).toBe('Output:\ntotal 4');
    expect(cleanToolContent(undefined)).toBe('');
  });

  it('unwraps the USER_REQUEST marker', () => {
    expect(unwrapUserRequest('<USER_REQUEST>\nhi there\n</USER_REQUEST>\nmeta')).toBe('hi there');
    expect(unwrapUserRequest('plain text')).toBe('plain text');
  });
});

describe('antigravity transcript mapping (live tail)', () => {
  it('emits only the un-seen delta for growing model text', () => {
    const state = createAntigravityTailState();
    const first = parseTranscriptLine(MODEL_LINE)!;
    expect(mapTranscriptEventToChunks(first, state)).toEqual([
      { type: 'text', content: 'Hello! I am Antigravity.' },
    ]);

    const grown = parseTranscriptLine(JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Hello! I am Antigravity. How can I help?',
    }))!;
    expect(mapTranscriptEventToChunks(grown, state)).toEqual([
      { type: 'text', content: ' How can I help?' },
    ]);
  });

  it('ignores USER_INPUT, CONVERSATION_HISTORY, and SYSTEM messages', () => {
    const state = createAntigravityTailState();
    const [user, history] = parseTranscript([USER_LINE, HISTORY_LINE].join('\n'));
    const system = parseTranscriptLine(SYSTEM_MESSAGE_LINE)!;
    expect(mapTranscriptEventToChunks(user, state)).toEqual([]);
    expect(mapTranscriptEventToChunks(history, state)).toEqual([]);
    expect(mapTranscriptEventToChunks(system, state)).toEqual([]);
  });

  it('emits tool_use on first sight and tool_result once terminal, de-duped per step', () => {
    const state = createAntigravityTailState();

    const running = parseTranscriptLine(RUN_RUNNING_LINE)!;
    expect(mapTranscriptEventToChunks(running, state)).toEqual([
      // RUN_COMMAND maps to the canonical Bash card; with no preceding planner
      // tool_call there is no command string to recover yet.
      { type: 'tool_use', id: 'agy-tool-3', name: 'Bash', input: {} },
    ]);

    // Same step seen again while still running -> nothing new.
    expect(mapTranscriptEventToChunks(running, state)).toEqual([]);

    // Step reaches DONE -> only the result chunk (tool_use already emitted).
    const done = parseTranscriptLine(RUN_DONE_LINE)!;
    expect(mapTranscriptEventToChunks(done, state)).toEqual([
      { type: 'tool_result', id: 'agy-tool-3', content: 'Output:\ntotal 4', isError: false },
    ]);

    // Re-reading the terminal step is idempotent.
    expect(mapTranscriptEventToChunks(done, state)).toEqual([]);
  });

  it('emits both chunks when a tool step is first seen terminal, with a parsed path', () => {
    const state = createAntigravityTailState();
    const view = parseTranscriptLine(VIEW_DONE_LINE)!;
    expect(mapTranscriptEventToChunks(view, state)).toEqual([
      // VIEW_FILE maps to the canonical Read card; the path is recovered from the
      // `File Path:` content line when no planner tool_call precedes it.
      { type: 'tool_use', id: 'agy-tool-4', name: 'Read', input: { path: '/vault/notes/a.md' } },
      {
        type: 'tool_result',
        id: 'agy-tool-4',
        content: 'File Path: `file:///vault/notes/a.md`\nTotal Lines: 1\n1: hello',
        isError: false,
      },
    ]);
  });

  it('marks failed tool steps as errors', () => {
    const state = createAntigravityTailState();
    const grep = parseTranscriptLine(GREP_ERROR_LINE)!;
    const chunks = mapTranscriptEventToChunks(grep, state);
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool_result', id: 'agy-tool-5', isError: true }),
    );
  });
});

describe('antigravity transcript mapping (history)', () => {
  it('reconstructs user and assistant messages from a full transcript', () => {
    const buffer = [USER_LINE, HISTORY_LINE, MODEL_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hi there' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello! I am Antigravity.',
    });
    expect(messages[0].timestamp).toBe(Date.parse('2026-05-20T11:38:18Z'));
  });

  it('attaches tool steps to the assistant message', () => {
    const buffer = [USER_LINE, HISTORY_LINE, MODEL_LINE, VIEW_DONE_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    expect(assistant.content).toBe('Hello! I am Antigravity.');
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls?.[0]).toMatchObject({
      name: 'Read',
      status: 'completed',
      input: { path: '/vault/notes/a.md' },
    });
    expect(assistant.toolCalls?.[0].result).toContain('1: hello');
  });

  it('supersedes a RUNNING tool line with its later DONE line', () => {
    const buffer = [USER_LINE, MODEL_LINE, RUN_RUNNING_LINE, RUN_DONE_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    const assistant = messages[messages.length - 1];
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls?.[0]).toMatchObject({ name: 'Bash', status: 'completed' });
  });
});

// ---------------------------------------------------------------------------
// Deepened coverage: planner tool_call correlation, canonical names, diff,
// subagent, thinking (probe-verified shapes, 2026-06-15).
// ---------------------------------------------------------------------------

const PLANNER_RUN_LINE = JSON.stringify({
  step_index: 2,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  content: 'Running git status.',
  // agy double-encodes arg string values.
  tool_calls: [
    {
      name: 'run_command',
      args: {
        CommandLine: '"git status"',
        Cwd: '"/vault"',
        WaitMsBeforeAsync: '5000',
        toolAction: '"Run git status"',
      },
    },
  ],
});
const RUN_AFTER_PLANNER_LINE = JSON.stringify({
  step_index: 3,
  source: 'MODEL',
  type: 'RUN_COMMAND',
  status: 'DONE',
  content: 'Created At: 2026-06-15T10:00:00Z\n\n\t\t\t\tOutput:\n\t\t\t\tnothing to commit',
});

const PLANNER_EDIT_LINE = JSON.stringify({
  step_index: 4,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  content: 'Editing note.md.',
  tool_calls: [
    {
      name: 'edit_file',
      args: {
        AbsolutePath: '"/vault/note.md"',
        old_string: '"# Hi"',
        new_string: '"# Hi\\n- item two"',
        toolAction: '"Append a line"',
      },
    },
  ],
});
const EDIT_DONE_LINE = JSON.stringify({
  step_index: 5,
  source: 'MODEL',
  type: 'EDIT_FILE',
  status: 'DONE',
  content: 'Created At: 2026-06-15T10:01:00Z\nFile Path: `/vault/note.md`\nEdited successfully.',
});

const PLANNER_SUBAGENT_LINE = JSON.stringify({
  step_index: 6,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  content: 'Spawning a subagent.',
  tool_calls: [
    { name: 'spawn_agent', args: { toolAction: '"Summarize the directory"' } },
  ],
});
const SUBAGENT_DONE_LINE = JSON.stringify({
  step_index: 7,
  source: 'MODEL',
  type: 'INVOKE_SUBAGENT',
  status: 'DONE',
  subagent_id: 'sub-123',
  content: 'Created At: 2026-06-15T10:02:00Z\n\n\t\t\t\tOutput:\n\t\t\t\tThe directory contains note.md.',
});

const THINKING_LINE = JSON.stringify({
  step_index: 8,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  thinking: 'I should inspect the repository first.',
  content: 'Let me look around.',
});

describe('antigravity planner tool_call parsing', () => {
  it('decodes JSON double-encoded arg values', () => {
    expect(decodeAgyArg('"git status"')).toBe('git status');
    expect(decodeAgyArg('5000')).toBe(5000);
    expect(decodeAgyArg('true')).toBe(true);
    // A bare (non-quoted) string is returned as-is.
    expect(decodeAgyArg('plain')).toBe('plain');
  });

  it('parses and decodes a planner tool_calls array', () => {
    const planner = parseTranscriptLine(PLANNER_RUN_LINE)!;
    const calls = parsePlannerToolCalls(planner);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('run_command');
    expect(calls[0].args.CommandLine).toBe('git status');
    expect(calls[0].args.Cwd).toBe('/vault');
  });

  it('returns an empty array for events without tool_calls', () => {
    const model = parseTranscriptLine(MODEL_LINE)!;
    expect(parsePlannerToolCalls(model)).toEqual([]);
  });

  it('maps agy actions onto canonical tool names', () => {
    expect(canonicalToolName('run_command')).toBe('Bash');
    expect(canonicalToolName('view_file')).toBe('Read');
    expect(canonicalToolName('edit_file')).toBe('Edit');
    expect(canonicalToolName('write_file')).toBe('Write');
    expect(canonicalToolName('list_dir')).toBe('LS');
    expect(canonicalToolName('spawn_agent')).toBe('Agent');
    expect(canonicalToolName('totally_unknown')).toBeUndefined();
  });

  it('builds canonical input from a run_command planner call', () => {
    const planner = parseTranscriptLine(PLANNER_RUN_LINE)!;
    const run = parseTranscriptLine(RUN_AFTER_PLANNER_LINE)!;
    const [call] = parsePlannerToolCalls(planner);
    expect(buildToolInput(run, call)).toEqual({ command: 'git status', cwd: '/vault' });
  });

  it('detects a subagent event by type and by spawn_agent planner call', () => {
    const subEvent = parseTranscriptLine(SUBAGENT_DONE_LINE)!;
    expect(isSubagentEvent(subEvent)).toBe(true);
    const run = parseTranscriptLine(RUN_AFTER_PLANNER_LINE)!;
    const [spawnCall] = parsePlannerToolCalls(parseTranscriptLine(PLANNER_SUBAGENT_LINE)!);
    expect(isSubagentEvent(run, spawnCall)).toBe(true);
    // A plain run_command step is not a subagent.
    expect(isSubagentEvent(run)).toBe(false);
  });
});

describe('antigravity mapping with planner correlation (live tail)', () => {
  it('recovers the real command for a RUN_COMMAND step from the preceding planner', () => {
    const state = createAntigravityTailState();
    const planner = parseTranscriptLine(PLANNER_RUN_LINE)!;
    // Planner narration streams text and stashes the tool call.
    expect(mapTranscriptEventToChunks(planner, state)).toEqual([
      { type: 'text', content: 'Running git status.' },
    ]);
    const run = parseTranscriptLine(RUN_AFTER_PLANNER_LINE)!;
    const chunks = mapTranscriptEventToChunks(run, state);
    expect(chunks[0]).toEqual({
      type: 'tool_use',
      id: 'agy-tool-3',
      name: 'Bash',
      input: { command: 'git status', cwd: '/vault' },
    });
    expect(chunks[1]).toMatchObject({ type: 'tool_result', id: 'agy-tool-3', isError: false });
    expect((chunks[1] as { content: string }).content).toContain('nothing to commit');
  });

  it('builds diffData for an EDIT_FILE step from old/new planner args', () => {
    const state = createAntigravityTailState();
    mapTranscriptEventToChunks(parseTranscriptLine(PLANNER_EDIT_LINE)!, state);
    const edit = parseTranscriptLine(EDIT_DONE_LINE)!;
    const chunks = mapTranscriptEventToChunks(edit, state);

    const use = chunks.find((c) => c.type === 'tool_use');
    expect(use).toMatchObject({
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: '/vault/note.md', old_string: '# Hi', new_string: '# Hi\n- item two' },
    });
  });

  it('emits subagent chunks for a subagent step', () => {
    const state = createAntigravityTailState();
    mapTranscriptEventToChunks(parseTranscriptLine(PLANNER_SUBAGENT_LINE)!, state);
    const sub = parseTranscriptLine(SUBAGENT_DONE_LINE)!;
    const chunks = mapTranscriptEventToChunks(sub, state);

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'subagent_tool_use',
        subagentId: 'sub-123',
        name: 'Agent',
      }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'subagent_tool_result',
        subagentId: 'sub-123',
        isError: false,
      }),
    );
  });

  it('emits a thinking chunk before the text delta, once per step', () => {
    const state = createAntigravityTailState();
    const thinking = parseTranscriptLine(THINKING_LINE)!;
    expect(mapTranscriptEventToChunks(thinking, state)).toEqual([
      { type: 'thinking', content: 'I should inspect the repository first.' },
      { type: 'text', content: 'Let me look around.' },
    ]);
    // Re-seeing the same step does not re-emit the thinking chunk.
    expect(mapTranscriptEventToChunks(thinking, state)).toEqual([]);
  });
});

describe('antigravity mapping with planner correlation (history)', () => {
  it('attaches the recovered command and a Bash name to the history tool call', () => {
    const buffer = [USER_LINE, PLANNER_RUN_LINE, RUN_AFTER_PLANNER_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    const assistant = messages[messages.length - 1];
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls?.[0]).toMatchObject({
      name: 'Bash',
      status: 'completed',
      input: { command: 'git status', cwd: '/vault' },
    });
  });

  it('attaches diffData to an EDIT_FILE history tool call', () => {
    const buffer = [USER_LINE, PLANNER_EDIT_LINE, EDIT_DONE_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    const assistant = messages[messages.length - 1];
    const tool = assistant.toolCalls?.[0];
    expect(tool?.name).toBe('Edit');
    expect(tool?.diffData?.filePath).toBe('/vault/note.md');
    expect(tool?.diffData?.stats.added).toBeGreaterThan(0);
  });

  it('attaches a subagent to an INVOKE_SUBAGENT history tool call', () => {
    const buffer = [USER_LINE, PLANNER_SUBAGENT_LINE, SUBAGENT_DONE_LINE].join('\n');
    const messages = transcriptToChatMessages(buffer);
    const assistant = messages[messages.length - 1];
    const tool = assistant.toolCalls?.[0];
    expect(tool?.name).toBe('Agent');
    expect(tool?.subagent).toMatchObject({
      id: 'sub-123',
      description: 'Summarize the directory',
      status: 'completed',
    });
  });
});

describe('stripAgyTrailingRecap', () => {
  it("drops agy's trailing '*** + heading' recap section", () => {
    const content = [
      "Hello! I'm Antigravity.",
      '',
      'How can I help you today?',
      '',
      '***',
      '',
      '### Summary of Actions',
      '* Scanned the workspace to locate projects.',
    ].join('\n');
    expect(stripAgyTrailingRecap(content)).toBe(
      "Hello! I'm Antigravity.\n\nHow can I help you today?",
    );
  });

  it('drops a localized recap heading (structural match, not text)', () => {
    const content = 'Mir geht es gut.\n\n***\n\n### Zusammenfassung\n* Auf die Begrüßung geantwortet.';
    expect(stripAgyTrailingRecap(content)).toBe('Mir geht es gut.');
  });

  it('drops a trailing `***` with nothing but blanks after it (dangling / streaming recap-start)', () => {
    // Prevents the live append-only stream from emitting an orphaned `***` it
    // cannot retract once the (later) recap heading arrives.
    expect(stripAgyTrailingRecap('Done.\n\n***')).toBe('Done.');
    expect(stripAgyTrailingRecap('Done.\n\n***\n\n')).toBe('Done.');
  });

  it('keeps a `***` divider that has real non-heading content after it', () => {
    const content = 'Part A\n\n***\n\nPart B';
    expect(stripAgyTrailingRecap(content)).toBe(content);
  });

  it('keeps content with no trailing recap', () => {
    const content = 'Just a normal answer with no recap.';
    expect(stripAgyTrailingRecap(content)).toBe(content);
  });

  it('returns an empty string unchanged', () => {
    expect(stripAgyTrailingRecap('')).toBe('');
  });
});

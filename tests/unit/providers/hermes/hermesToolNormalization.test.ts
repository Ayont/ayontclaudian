import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GREP,
  TOOL_READ,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '@/core/tools/toolNames';
import {
  extractHermesTitlePrefix,
  normalizeHermesToolInput,
  normalizeHermesToolName,
  normalizeHermesToolUseResult,
  resolveHermesRawToolName,
} from '@/providers/hermes/normalization/hermesToolNormalization';

// Hermes suppresses `rawInput` for its "polished" tools, so the ACP title is
// the only identity on the wire. These titles come from `build_tool_title`.
describe('resolveHermesRawToolName', () => {
  it.each([
    ['terminal: echo HERMES_TOOL_PROBE', 'execute', 'terminal'],
    ['read: package.json', 'read', 'read_file'],
    ['write: notes/todo.md', 'edit', 'write_file'],
    ['patch (replace): src/main.ts', 'edit', 'patch'],
    ['search: TODO', 'search', 'search_files'],
    ['web search: hermes agent', 'fetch', 'web_search'],
    ['extract: https://example.com (+2)', 'fetch', 'web_extract'],
    ['web extract', 'fetch', 'web_extract'],
    ['process manage: abc123', 'execute', 'process'],
    ['delegate batch (3 tasks)', 'execute', 'delegate_task'],
    ['delegate: refactor the parser', 'execute', 'delegate_task'],
    ['delegate task', 'execute', 'delegate_task'],
    ['session search: hermes', 'other', 'session_search'],
    ['recent sessions', 'other', 'session_search'],
    ['memory store: preferences', 'other', 'memory'],
    ['python: print(1)', 'execute', 'execute_code'],
    ['python code', 'execute', 'execute_code'],
    ['todo (3 items)', 'other', 'todo'],
    ['skill view (github-auth/README.md)', 'read', 'skill_view'],
    ['skills list (dev)', 'read', 'skills_list'],
    ['skill create: my-skill', 'edit', 'skill_manage'],
    ['navigate: https://example.com', 'fetch', 'browser_navigate'],
    ['browser snapshot', 'read', 'browser_snapshot'],
    ['generate image: a cat', 'execute', 'image_generate'],
    ['cron add: daily-report', 'other', 'cronjob'],
  ])('decodes %s', (title, kind, expected) => {
    expect(resolveHermesRawToolName(undefined, { kind, title })).toBe(expected);
  });

  it('keeps the already-resolved name when an update omits the title', () => {
    expect(resolveHermesRawToolName('terminal', { kind: 'execute' })).toBe('terminal');
  });

  it('falls back to the ACP kind for an unmapped title', () => {
    expect(resolveHermesRawToolName(undefined, { kind: 'execute', title: null })).toBe('terminal');
    expect(resolveHermesRawToolName(undefined, { kind: 'read', title: '' })).toBe('read_file');
  });

  it('keeps an unknown title as its own tool name', () => {
    expect(resolveHermesRawToolName(undefined, { kind: 'other', title: 'ha_call_service: light' }))
      .toBe('ha_call_service');
  });
});

describe('extractHermesTitlePrefix', () => {
  it('strips both the argument tail and a parenthesised qualifier', () => {
    expect(extractHermesTitlePrefix('patch (replace): src/main.ts')).toBe('patch');
    expect(extractHermesTitlePrefix('todo (3 items)')).toBe('todo');
    expect(extractHermesTitlePrefix('  BROWSER SNAPSHOT ')).toBe('browser snapshot');
    expect(extractHermesTitlePrefix(null)).toBe('');
  });
});

describe('normalizeHermesToolName', () => {
  it.each([
    ['terminal', TOOL_BASH],
    ['execute_code', TOOL_BASH],
    ['read_file', TOOL_READ],
    ['write_file', TOOL_WRITE],
    ['patch', TOOL_EDIT],
    ['search_files', TOOL_GREP],
    ['web_search', TOOL_WEB_SEARCH],
    ['web_extract', TOOL_WEB_FETCH],
    ['delegate_task', TOOL_TASK],
    ['todo', TOOL_TODO_WRITE],
  ])('maps %s to the canonical tool name', (rawName, expected) => {
    expect(normalizeHermesToolName(rawName)).toBe(expected);
  });

  it('passes an unmapped tool through and guards against nothing', () => {
    expect(normalizeHermesToolName('kanban_create')).toBe('kanban_create');
    expect(normalizeHermesToolName(undefined)).toBe('tool');
  });
});

describe('normalizeHermesToolInput', () => {
  it('renames Hermes\' path argument to the shared file_path key', () => {
    expect(normalizeHermesToolInput('read_file', { limit: 5, path: 'package.json' }))
      .toEqual({ file_path: 'package.json', limit: 5 });
    expect(normalizeHermesToolInput('write_file', { content: 'hi', path: 'a.md' }))
      .toEqual({ content: 'hi', file_path: 'a.md' });
  });

  it('maps a patch onto the shared old/new string shape', () => {
    expect(normalizeHermesToolInput('patch', {
      mode: 'replace',
      new_text: 'b',
      old_text: 'a',
      path: 'src/main.ts',
    })).toEqual({
      file_path: 'src/main.ts',
      mode: 'replace',
      new_string: 'b',
      old_string: 'a',
    });
  });

  it('renders python code as a command so the bash renderer can show it', () => {
    expect(normalizeHermesToolInput('execute_code', { code: 'print(1)' }))
      .toEqual({ command: 'print(1)' });
  });

  it('leaves unmapped tools untouched', () => {
    const input = { board: 'main', title: 'Ship it' };
    expect(normalizeHermesToolInput('kanban_create', input)).toBe(input);
  });
});

describe('normalizeHermesToolUseResult', () => {
  it('surfaces the edited file path for diff rendering', () => {
    expect(normalizeHermesToolUseResult('patch', { file_path: 'src/main.ts' }, null))
      .toEqual({ filePath: 'src/main.ts' });
    expect(normalizeHermesToolUseResult('write_file', {}, { metadata: { path: 'a.md' } }))
      .toEqual({ filePath: 'a.md' });
  });

  it('returns nothing for tools that produce no diff', () => {
    expect(normalizeHermesToolUseResult('terminal', { command: 'ls' }, null)).toBeUndefined();
    expect(normalizeHermesToolUseResult('patch', {}, null)).toBeUndefined();
  });
});

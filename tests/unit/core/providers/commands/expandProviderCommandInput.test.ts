import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import {
  expandProviderCommandInput,
  substituteArguments,
} from '@/core/providers/commands/expandProviderCommandInput';

function makeEntry(overrides: Partial<ProviderCommandEntry>): ProviderCommandEntry {
  return {
    id: overrides.id ?? 'id',
    providerId: 'kimi',
    kind: 'command',
    name: 'review',
    content: 'Review this code:\n$ARGUMENTS',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    ...overrides,
  };
}

describe('substituteArguments', () => {
  it('replaces $ARGUMENTS with the full argument string', () => {
    expect(substituteArguments('Do: $ARGUMENTS', 'fix the bug')).toBe('Do: fix the bug');
  });

  it('replaces positional $1/$2 from whitespace-split args', () => {
    expect(substituteArguments('$1 then $2', 'alpha beta')).toBe('alpha then beta');
  });

  it('renders missing positionals as empty strings', () => {
    expect(substituteArguments('[$1][$2]', 'only')).toBe('[only][]');
  });

  it('leaves a template with no placeholders untouched', () => {
    expect(substituteArguments('static prompt', 'ignored')).toBe('static prompt');
  });
});

describe('expandProviderCommandInput', () => {
  const cmd = makeEntry({ name: 'review', content: 'Review this:\n$ARGUMENTS', insertPrefix: '/' });
  const skill = makeEntry({
    name: 'pirate',
    kind: 'skill',
    content: 'You speak like a pirate.',
    displayPrefix: '$',
    insertPrefix: '$',
  });
  const entries = [cmd, skill];

  it('expands a /command with arguments', () => {
    expect(expandProviderCommandInput('/review the auth module', entries)).toBe(
      'Review this:\nthe auth module',
    );
  });

  it('expands a /command with no arguments (empty $ARGUMENTS)', () => {
    expect(expandProviderCommandInput('/review', entries)).toBe('Review this:\n');
  });

  it('is case-insensitive on the command name', () => {
    expect(expandProviderCommandInput('/REVIEW x', entries)).toBe('Review this:\nx');
  });

  it('prepends skill content then the user request for a $skill', () => {
    expect(expandProviderCommandInput('$pirate tell me a joke', entries)).toBe(
      'You speak like a pirate.\n\ntell me a joke',
    );
  });

  it('returns just the skill content when no trailing request', () => {
    expect(expandProviderCommandInput('$pirate', entries)).toBe('You speak like a pirate.');
  });

  it('passes through an unknown command unchanged', () => {
    expect(expandProviderCommandInput('/unknown foo', entries)).toBe('/unknown foo');
  });

  it('passes through a plain prompt that is not an invocation', () => {
    expect(expandProviderCommandInput('please /review this', entries)).toBe('please /review this');
    expect(expandProviderCommandInput('hello world', entries)).toBe('hello world');
  });

  it('does not match a prefix used by a different trigger char', () => {
    // `$review` should not match the `/`-prefixed command entry.
    expect(expandProviderCommandInput('$review x', entries)).toBe('$review x');
  });

  it('passes through when the matched entry has empty content', () => {
    const empty = makeEntry({ name: 'noop', content: '', insertPrefix: '/' });
    expect(expandProviderCommandInput('/noop args', [empty])).toBe('/noop args');
  });
});

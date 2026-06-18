import { resolveAutoQuestionAnswers, summarizeAutoAnswers } from '@/features/chat/rendering/autoQuestionAnswer';

describe('resolveAutoQuestionAnswers', () => {
  it('returns null when there are no questions', () => {
    expect(resolveAutoQuestionAnswers({})).toBeNull();
    expect(resolveAutoQuestionAnswers({ questions: 'nope' })).toBeNull();
    expect(resolveAutoQuestionAnswers({ questions: [] })).toBeNull();
  });

  it('selects the first (recommended) option keyed by question text', () => {
    const result = resolveAutoQuestionAnswers({
      questions: [
        {
          question: 'Which database?',
          options: [
            { label: 'Postgres (Recommended)', description: '' },
            { label: 'MySQL', description: '' },
          ],
        },
      ],
    });
    expect(result).toEqual({ 'Which database?': 'Postgres (Recommended)' });
  });

  it('prefers an option value over its label, and a stable id over the question text', () => {
    const result = resolveAutoQuestionAnswers({
      questions: [
        {
          id: 'q-db',
          question: 'Which database?',
          options: [
            { label: 'Postgres', value: 'postgres', description: '' },
            { label: 'MySQL', value: 'mysql', description: '' },
          ],
        },
      ],
    });
    expect(result).toEqual({ 'q-db': 'postgres' });
  });

  it('wraps multiSelect answers in a single-element array', () => {
    const result = resolveAutoQuestionAnswers({
      questions: [
        {
          question: 'Pick features',
          multiSelect: true,
          options: [
            { label: 'A', description: '' },
            { label: 'B', description: '' },
          ],
        },
      ],
    });
    expect(result).toEqual({ 'Pick features': ['A'] });
  });

  it('answers every question in a multi-question prompt', () => {
    const result = resolveAutoQuestionAnswers({
      questions: [
        { question: 'One?', options: [{ label: 'a', description: '' }] },
        { question: 'Two?', options: [{ label: 'b', description: '' }] },
      ],
    });
    expect(result).toEqual({ 'One?': 'a', 'Two?': 'b' });
  });

  it('resolves a free-text-only (isOther) question to an empty preference', () => {
    expect(
      resolveAutoQuestionAnswers({
        questions: [{ question: 'Custom name?', isOther: true }],
      }),
    ).toEqual({ 'Custom name?': '' });

    expect(
      resolveAutoQuestionAnswers({
        questions: [{ question: 'Custom names?', isOther: true, multiSelect: true }],
      }),
    ).toEqual({ 'Custom names?': [] });
  });

  it('skips malformed entries but still answers valid ones', () => {
    const result = resolveAutoQuestionAnswers({
      questions: [
        null,
        'string',
        { noQuestion: true },
        { question: 'Valid?', options: ['yes', 'no'] },
      ],
    });
    expect(result).toEqual({ 'Valid?': 'yes' });
  });
});

describe('summarizeAutoAnswers', () => {
  it('renders a single answer as "question → value"', () => {
    expect(summarizeAutoAnswers({ 'Which database?': 'postgres' })).toBe('Which database? → postgres');
  });

  it('joins multiple answers with a middot', () => {
    expect(summarizeAutoAnswers({ DB: 'postgres', Theme: 'dark' })).toBe('DB → postgres · Theme → dark');
  });

  it('joins multiSelect arrays with commas', () => {
    expect(summarizeAutoAnswers({ Features: ['a', 'b'] })).toBe('Features → a, b');
  });

  it('truncates very long question keys', () => {
    const longKey = 'x'.repeat(60);
    const out = summarizeAutoAnswers({ [longKey]: 'v' });
    expect(out).toBe(`${'x'.repeat(48)}… → v`);
  });

  it('shows just the key when the value is empty', () => {
    expect(summarizeAutoAnswers({ 'Custom name?': '' })).toBe('Custom name?');
  });
});

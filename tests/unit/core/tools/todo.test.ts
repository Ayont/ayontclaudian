import {
  extractLastTodosFromMessages,
  getRestorableTodos,
  normalizeTodoItems,
  parseTodoInput,
  summarizeTodos,
} from '@/core/tools/todo';
import { TOOL_TODO_WRITE } from '@/core/tools/toolNames';

describe('parseTodoInput', () => {
  it('should parse valid todo items', () => {
    const input = {
      todos: [
        { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
        { content: 'Fix bug', status: 'in_progress', activeForm: 'Fixing bug' },
        { content: 'Deploy', status: 'completed', activeForm: 'Deploying' },
      ],
    };

    const result = parseTodoInput(input);

    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ content: 'Run tests', status: 'pending', activeForm: 'Running tests' });
    expect(result![1].status).toBe('in_progress');
    expect(result![2].status).toBe('completed');
  });

  it('should return null when todos key is missing', () => {
    expect(parseTodoInput({})).toBeNull();
  });

  it('should return null when todos is not an array', () => {
    expect(parseTodoInput({ todos: 'not an array' })).toBeNull();
    expect(parseTodoInput({ todos: 42 })).toBeNull();
    expect(parseTodoInput({ todos: null })).toBeNull();
  });

  it('should skip items without any usable text', () => {
    const input = {
      todos: [
        { content: 'Valid', status: 'pending', activeForm: 'Working' },
        { content: '', status: 'pending', activeForm: 'Working' },
        { content: '   ', status: 'pending' },
        { status: 'pending' },
        null,
        42,
        false,
      ],
    };

    const result = parseTodoInput(input);

    expect(result).toHaveLength(1);
    expect(result![0].content).toBe('Valid');
  });

  it('should return null when all items are unusable', () => {
    const input = {
      todos: [
        { content: '', status: 'pending', activeForm: 'Working' },
        null,
        { status: 'pending' },
      ],
    };

    expect(parseTodoInput(input)).toBeNull();
  });

  it('should return null for empty todos array', () => {
    expect(parseTodoInput({ todos: [] })).toBeNull();
  });

  it('should fall back to the content when activeForm is missing or empty', () => {
    const result = parseTodoInput({
      todos: [
        { content: 'Write tests', status: 'pending' },
        { content: 'Ship it', status: 'in_progress', activeForm: '' },
      ],
    });

    expect(result).toEqual([
      { content: 'Write tests', status: 'pending', activeForm: 'Write tests' },
      { content: 'Ship it', status: 'in_progress', activeForm: 'Ship it' },
    ]);
  });

  it('should accept snake_case active_form', () => {
    const result = parseTodoInput({
      todos: [{ content: 'Lint', status: 'in_progress', active_form: 'Linting' }],
    });

    expect(result![0].activeForm).toBe('Linting');
  });

  it.each([
    ['inProgress', 'in_progress'],
    ['in-progress', 'in_progress'],
    ['In Progress', 'in_progress'],
    ['active', 'in_progress'],
    ['done', 'completed'],
    ['cancelled', 'completed'],
    ['canceled', 'completed'],
    ['COMPLETED', 'completed'],
    ['pending', 'pending'],
    ['unknown', 'pending'],
    [undefined, 'pending'],
    [7, 'pending'],
  ])('should map status %p to %p', (status, expected) => {
    const result = parseTodoInput({ todos: [{ content: 'Task', status }] });

    expect(result![0].status).toBe(expected);
  });

  it.each(['title', 'text', 'step', 'description'])('should read the text from "%s"', (key) => {
    const result = parseTodoInput({ todos: [{ [key]: '  Build the thing  ', status: 'pending' }] });

    expect(result![0].content).toBe('Build the thing');
    expect(result![0].activeForm).toBe('Build the thing');
  });

  it('should prefer content over alternative text keys', () => {
    const result = parseTodoInput({ todos: [{ content: 'Primary', title: 'Secondary' }] });

    expect(result![0].content).toBe('Primary');
  });

  it('should keep a known priority and drop unknown ones', () => {
    const result = parseTodoInput({
      todos: [
        { content: 'A', status: 'pending', priority: 'high' },
        { content: 'B', status: 'pending', priority: 'Medium' },
        { content: 'C', status: 'pending', priority: 'low' },
        { content: 'D', status: 'pending', priority: 'urgent' },
      ],
    });

    expect(result!.map((todo) => todo.priority)).toEqual(['high', 'medium', 'low', undefined]);
    expect(result![3]).not.toHaveProperty('priority');
  });

  it('should keep a non-empty id as a string', () => {
    const result = parseTodoInput({
      todos: [
        { id: 'a1', content: 'A' },
        { id: 3, content: 'B' },
        { id: '', content: 'C' },
      ],
    });

    expect(result![0].id).toBe('a1');
    expect(result![1].id).toBe('3');
    expect(result![2]).not.toHaveProperty('id');
  });

  it('should accept plain strings as pending items', () => {
    const result = parseTodoInput({ todos: ['Read the spec', ''] });

    expect(result).toEqual([
      { content: 'Read the spec', status: 'pending', activeForm: 'Read the spec' },
    ]);
  });

  it('should accept an ACP-style entries list', () => {
    const result = parseTodoInput({
      entries: [{ content: 'Plan', priority: 'high', status: 'in_progress' }],
    });

    expect(result).toEqual([
      { content: 'Plan', status: 'in_progress', activeForm: 'Plan', priority: 'high' },
    ]);
  });
});

describe('normalizeTodoItems', () => {
  it('returns an empty list for non-arrays', () => {
    expect(normalizeTodoItems(undefined)).toEqual([]);
    expect(normalizeTodoItems('x')).toEqual([]);
  });

  it('returns canonical items for a raw provider list', () => {
    expect(normalizeTodoItems([{ id: '1', content: 'Recon', status: 'in_progress' }])).toEqual([
      { activeForm: 'Recon', content: 'Recon', id: '1', status: 'in_progress' },
    ]);
  });
});

describe('summarizeTodos', () => {
  it('counts progress and finds the current task', () => {
    const summary = summarizeTodos([
      { content: 'A', status: 'completed', activeForm: 'A' },
      { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
      { content: 'C', status: 'pending', activeForm: 'C' },
    ]);

    expect(summary).toEqual({
      allCompleted: false,
      completed: 1,
      current: { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
      currentIndex: 1,
      total: 3,
    });
  });

  it('reports a finished list', () => {
    const summary = summarizeTodos([{ content: 'A', status: 'completed', activeForm: 'A' }]);

    expect(summary.allCompleted).toBe(true);
    expect(summary.current).toBeUndefined();
    expect(summary.currentIndex).toBe(-1);
  });

  it('never reports an empty list as finished', () => {
    expect(summarizeTodos([]).allCompleted).toBe(false);
  });
});

describe('extractLastTodosFromMessages', () => {
  it('should extract todos from the last TodoWrite tool call', () => {
    const messages = [
      {
        role: 'user',
        content: 'Do something',
      },
      {
        role: 'assistant',
        toolCalls: [
          {
            name: TOOL_TODO_WRITE,
            input: {
              todos: [
                { content: 'First', status: 'completed' as const, activeForm: 'First-ing' },
              ],
            },
          },
        ],
      },
      {
        role: 'assistant',
        toolCalls: [
          {
            name: TOOL_TODO_WRITE,
            input: {
              todos: [
                { content: 'Second', status: 'pending' as const, activeForm: 'Second-ing' },
              ],
            },
          },
        ],
      },
    ];

    const result = extractLastTodosFromMessages(messages);

    expect(result).toHaveLength(1);
    expect(result![0].content).toBe('Second');
  });

  it('should return null when no messages exist', () => {
    expect(extractLastTodosFromMessages([])).toBeNull();
  });

  it('should return null when no assistant messages have tool calls', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant' },
    ];

    expect(extractLastTodosFromMessages(messages)).toBeNull();
  });

  it('should return null when no TodoWrite tool calls exist', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [
          { name: 'Read', input: { file_path: '/test.txt' } },
        ],
      },
    ];

    expect(extractLastTodosFromMessages(messages)).toBeNull();
  });

  it('should skip user messages', () => {
    const messages = [
      {
        role: 'user',
        toolCalls: [
          {
            name: TOOL_TODO_WRITE,
            input: {
              todos: [{ content: 'Should not find', status: 'pending', activeForm: 'Nope' }],
            },
          },
        ],
      },
    ];

    expect(extractLastTodosFromMessages(messages)).toBeNull();
  });

  it('should pick the last TodoWrite within a message with multiple tool calls', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [
          {
            name: TOOL_TODO_WRITE,
            input: {
              todos: [{ content: 'Earlier', status: 'pending' as const, activeForm: 'Earlier-ing' }],
            },
          },
          {
            name: 'Read',
            input: { file_path: '/test.txt' },
          },
          {
            name: TOOL_TODO_WRITE,
            input: {
              todos: [{ content: 'Later', status: 'in_progress' as const, activeForm: 'Later-ing' }],
            },
          },
        ],
      },
    ];

    const result = extractLastTodosFromMessages(messages);

    expect(result).toHaveLength(1);
    expect(result![0].content).toBe('Later');
  });

  it('should return null when TodoWrite has invalid input', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [
          {
            name: TOOL_TODO_WRITE,
            input: { todos: 'not-an-array' },
          },
        ],
      },
    ];

    expect(extractLastTodosFromMessages(messages)).toBeNull();
  });
});

describe('getRestorableTodos', () => {
  const todoWrite = (todos: unknown[]) => ({
    role: 'assistant',
    toolCalls: [{ name: TOOL_TODO_WRITE, input: { todos } }],
  });

  it('restores the latest unfinished list', () => {
    const result = getRestorableTodos([
      todoWrite([{ content: 'Old', status: 'pending' }]),
      { role: 'user' },
      todoWrite([
        { content: 'Done', status: 'completed' },
        { content: 'Next', status: 'in_progress' },
      ]),
    ]);

    expect(result?.map((todo) => todo.content)).toEqual(['Done', 'Next']);
  });

  it('stays hidden when the latest list is finished', () => {
    const result = getRestorableTodos([
      todoWrite([{ content: 'Old', status: 'pending' }]),
      todoWrite([{ content: 'Done', status: 'completed' }]),
    ]);

    expect(result).toBeNull();
  });

  it('restores lists written by providers without activeForm', () => {
    const result = getRestorableTodos([todoWrite([{ content: 'Recon', status: 'in_progress' }])]);

    expect(result).toEqual([{ content: 'Recon', status: 'in_progress', activeForm: 'Recon' }]);
  });

  it('returns null when there is no list', () => {
    expect(getRestorableTodos([{ role: 'assistant' }])).toBeNull();
  });
});

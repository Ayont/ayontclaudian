import { createMockEl, type MockElement } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { SubagentInfo, ToolCallInfo } from '@/core/types';
import {
  addSubagentToolCall,
  createAsyncSubagentBlock,
  createSubagentBlock,
  finalizeAsyncSubagent,
  finalizeSubagentBlock,
  markAsyncSubagentOrphaned,
  refreshSubagentCard,
  renderStoredAsyncSubagent,
  renderStoredSubagent,
  updateAsyncSubagentRunning,
  updateSubagentToolResult,
} from '@/features/chat/rendering/SubagentRenderer';

const getTextByClass = (el: MockElement, cls: string): string[] => {
  const results: string[] = [];
  const visit = (node: MockElement) => {
    if (node.hasClass(cls)) {
      results.push(node.textContent);
    }
    node.children.forEach(visit);
  };
  visit(el);
  return results;
};

describe('Sync Subagent Renderer', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  describe('createSubagentBlock', () => {
    it('should start collapsed by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should set aria-expanded to false by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should hide content by default', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect((state.contentEl as any).style.display).toBe('none');
    });

    it('should set correct ARIA attributes for accessibility', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('role')).toBe('button');
      expect(state.headerEl.getAttribute('tabindex')).toBe('0');
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
      expect(state.headerEl.getAttribute('aria-label')).toContain('Subagent: ');
    });

    it('should toggle expand/collapse on header click', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
      expect((state.contentEl as any).style.display).toBe('none');

      // Trigger click
      (state.headerEl as any).click();

      // Should be expanded
      expect(state.info.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
      expect((state.contentEl as any).hasClass('claudian-hidden')).toBe(false);

      // Click again to collapse
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
      expect((state.contentEl as any).style.display).toBe('none');
    });

    it('should update aria-expanded on toggle', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');

      // Expand
      (state.headerEl as any).click();
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('true');

      // Collapse
      (state.headerEl as any).click();
      expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should show description in label', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'My task description' });

      expect(state.labelEl.textContent).toBe('My task description');
    });

    it('should not show a tool count badge in the header', () => {
      const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
    });
  });

  describe('renderStoredSubagent', () => {
    it('should start collapsed by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should set aria-expanded to false by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      const headerEl = (wrapperEl as any).children[0];
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('should hide content by default', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

      const contentEl = (wrapperEl as any).querySelector('.claudian-subagent-content');
      expect(contentEl.style.display).toBe('none');
    });

    it('should toggle expand/collapse on click', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
      };

      const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];
      const contentEl = (wrapperEl as any).querySelector('.claudian-subagent-content');

      // Initially collapsed
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
      expect(contentEl.style.display).toBe('none');

      // Click to expand
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
      expect(contentEl.hasClass('claudian-hidden')).toBe(false);
      expect(headerEl.getAttribute('aria-expanded')).toBe('true');

      // Click to collapse
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
      expect(contentEl.style.display).toBe('none');
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });
  });
});

describe('keyboard navigation', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('should support keyboard navigation (Enter/Space) on createSubagentBlock', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    // Simulate keydown event
    const keydownHandlers: Array<(e: any) => void> = [];
    const originalAddEventListener = state.headerEl.addEventListener;
    state.headerEl.addEventListener = (event: string, handler: (e: any) => void) => {
      if (event === 'keydown') {
        keydownHandlers.push(handler);
      }
      originalAddEventListener.call(state.headerEl, event, handler);
    };

    // Re-check - the handler should already be registered
    // We need to dispatch a keydown event
    const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
    (state.headerEl as any).dispatchEvent({ type: 'keydown', ...enterEvent });

    // The handler should have been called and expanded
    expect(state.info.isExpanded).toBe(true);
    expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);

    // Space to collapse
    const spaceEvent = { key: ' ', preventDefault: jest.fn() };
    (state.headerEl as any).dispatchEvent({ type: 'keydown', ...spaceEvent });

    expect(state.info.isExpanded).toBe(false);
    expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
  });

  it('should support keyboard navigation (Enter/Space) on renderStoredSubagent', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Test task',
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
    const headerEl = (wrapperEl as any).children[0];

    // Simulate Enter key
    const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
    headerEl.dispatchEvent({ type: 'keydown', ...enterEvent });

    expect((wrapperEl as any).hasClass('expanded')).toBe(true);

    // Simulate Space key to collapse
    const spaceEvent = { key: ' ', preventDefault: jest.fn() };
    headerEl.dispatchEvent({ type: 'keydown', ...spaceEvent });

    expect((wrapperEl as any).hasClass('expanded')).toBe(false);
  });
});

describe('Async Subagent Renderer', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  describe('inline display behavior', () => {
    it('should start collapsed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.info.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('should have aria-label indicating expand action', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      expect(state.headerEl.getAttribute('aria-label')).toContain('Subagent: ');
    });

    it('should expand content when header is clicked', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Initially collapsed
      expect(state.info.isExpanded).toBe(false);

      // Trigger click to expand
      (state.headerEl as any).click();

      expect(state.info.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should toggle expansion on repeated clicks', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

      // Click to expand
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(true);

      // Click to collapse
      (state.headerEl as any).click();
      expect(state.info.isExpanded).toBe(false);
    });

    it('should expand when Enter key is pressed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test' });

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
      (state.headerEl as any).dispatchEvent({ type: 'keydown', ...enterEvent });

      expect(state.info.isExpanded).toBe(true);
    });

    it('should expand when Space key is pressed', () => {
      const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Test' });

      const spaceEvent = { key: ' ', preventDefault: jest.fn() };
      (state.headerEl as any).dispatchEvent({ type: 'keydown', ...spaceEvent });

      expect(state.info.isExpanded).toBe(true);
    });
  });

  it('shows label immediately and initializing status text', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-1', { description: 'Background job' });

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Startet');
    expect((state.wrapperEl as any).getClasses()).toEqual(expect.arrayContaining(['async', 'pending']));
  });

  it('shows prompt in content and keeps label visible while running', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-2', { description: 'Background job', prompt: 'Do the work' });

    updateAsyncSubagentRunning(state, 'agent-xyz');

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Läuft im Hintergrund');
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-prompt-text')[0];
    expect(contentText).toContain('Do the work');
    expect((state.wrapperEl as any).getClasses()).toEqual(expect.arrayContaining(['running', 'async']));
  });

  it('finalizes to completed and reveals description', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-3', { description: 'Background job' });
    state.info.toolCalls.push(
      {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: 'a.md' },
        status: 'completed',
        result: 'A',
        isExpanded: false,
      },
      {
        id: 'tool-2',
        name: 'Grep',
        input: { pattern: 'x' },
        status: 'completed',
        result: 'B',
        isExpanded: false,
      }
    );
    updateAsyncSubagentRunning(state, 'agent-complete');

    (setIcon as jest.Mock).mockClear();
    finalizeAsyncSubagent(state, 'all done', false);

    expect(state.labelEl.textContent).toBe('Background job');
    expect(state.statusTextEl.textContent).toBe('Fertig');
    expect((state.wrapperEl as any).hasClass('done')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toBe('all done');
    const lastIcon = (setIcon as jest.Mock).mock.calls.pop();
    expect(lastIcon?.[1]).toBe('check');
  });

  it('finalizes to error and truncates error message', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-4', { description: 'Background job' });
    updateAsyncSubagentRunning(state, 'agent-error');

    (setIcon as jest.Mock).mockClear();
    finalizeAsyncSubagent(state, 'failure happened', true);

    expect(state.statusTextEl.textContent).toBe('Fehlgeschlagen');
    expect((state.wrapperEl as any).hasClass('error')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toBe('failure happened');
    const lastIcon = (setIcon as jest.Mock).mock.calls.pop();
    expect(lastIcon?.[1]).toBe('x');
  });

  it('marks async subagent as orphaned', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'task-5', { description: 'Background job' });

    markAsyncSubagentOrphaned(state);

    expect(state.statusTextEl.textContent).toBe('Abgebrochen');
    expect((state.wrapperEl as any).hasClass('orphaned')).toBe(true);
    const contentText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(contentText).toContain('Der Chat endete, bevor der Subagent fertig war.');
  });

  describe('renderStoredAsyncSubagent', () => {
    it('should return wrapper element', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect(wrapperEl).toBeDefined();
      expect((wrapperEl as any).hasClass('claudian-subagent-list')).toBe(true);
    });

    it('should expand content when header is clicked', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      // Click to expand
      headerEl.click();

      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should expand on Enter key', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
      headerEl.dispatchEvent({ type: 'keydown', ...enterEvent });

      expect((wrapperEl as any).hasClass('expanded')).toBe(true);
    });

    it('should have aria-label indicating expand action', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      expect(headerEl.getAttribute('aria-label')).toContain('Subagent: ');
    });

    it('should toggle expansion on repeated clicks', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'completed',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);
      const headerEl = (wrapperEl as any).children[0];

      // Click to expand
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(true);

      // Click to collapse
      headerEl.click();
      expect((wrapperEl as any).hasClass('expanded')).toBe(false);
    });

    it('renders error status correctly', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Failed task',
        status: 'error',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'error',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('error')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
      expect(contentText).toBe('Fehlgeschlagen.');
    });

    it('renders orphaned status correctly', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Lost task',
        status: 'error',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'orphaned',
      };

      (setIcon as jest.Mock).mockClear();
      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('error')).toBe(true);
      expect((wrapperEl as any).hasClass('orphaned')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
      expect(contentText).toContain('Der Chat endete, bevor der Subagent fertig war.');
      // Should use alert-circle icon
      expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'alert-circle');
    });

    it('renders running status with prompt', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Running task',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'running',
        prompt: 'Do some work',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      expect((wrapperEl as any).hasClass('running')).toBe(true);
      const contentText = getTextByClass(wrapperEl as any, 'claudian-subagent-prompt-text')[0];
      expect(contentText).toContain('Do some work');
    });

    it('renders pending status as running', () => {
      const subagent: SubagentInfo = {
        id: 'task-1',
        description: 'Pending task',
        status: 'running',
        toolCalls: [],
        isExpanded: false,
        mode: 'async',
        asyncStatus: 'pending',
      };

      const wrapperEl = renderStoredAsyncSubagent(parentEl as any, subagent);

      // pending maps to running display status
      expect((wrapperEl as any).hasClass('running')).toBe(true);
    });
  });
});

describe('addSubagentToolCall', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('adds tool call to state without rendering a header count', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };

    addSubagentToolCall(state, toolCall);

    expect(state.info.toolCalls).toHaveLength(1);
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  it('clears previous content and renders new tool item', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall1: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall1);

    const toolCall2: ToolCallInfo = {
      id: 'tool-2',
      name: 'Grep',
      input: { pattern: 'test' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall2);

    expect(state.info.toolCalls).toHaveLength(2);
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  it('merges repeated tool IDs instead of duplicating tool rows', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Write',
      input: {},
      status: 'running',
      isExpanded: false,
    });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Write',
      input: { file_path: 'notes.md' },
      status: 'running',
      isExpanded: false,
    });

    expect(state.info.toolCalls).toHaveLength(1);
    expect(state.info.toolCalls[0]).toEqual(
      expect.objectContaining({
        id: 'tool-1',
        input: { file_path: 'notes.md' },
      })
    );
    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
    expect(getTextByClass(state.toolsContainerEl as any, 'claudian-subagent-tool-name')).toEqual(['Write']);
    expect(getTextByClass(state.toolsContainerEl as any, 'claudian-subagent-tool-summary')).toEqual(['notes.md']);
  });
});

describe('updateSubagentToolResult', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('updates tool call status in state', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall);

    const updatedToolCall: ToolCallInfo = {
      ...toolCall,
      status: 'completed',
      result: 'File contents here',
    };
    updateSubagentToolResult(state, 'tool-1', updatedToolCall);

    expect(state.info.toolCalls[0].status).toBe('completed');
  });

  it('does not update tool call for non-matching tool ID', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    };
    addSubagentToolCall(state, toolCall);

    updateSubagentToolResult(state, 'tool-999', { ...toolCall, id: 'tool-999', status: 'completed' });

    expect(state.info.toolCalls[0].status).toBe('running');
  });
});

describe('finalizeSubagentBlock', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('sets status to completed and adds done class', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    (setIcon as jest.Mock).mockClear();
    finalizeSubagentBlock(state, 'All done', false);

    expect(state.info.status).toBe('completed');
    expect(state.info.result).toBe('All done');
    expect((state.wrapperEl as any).hasClass('done')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
  });

  it('sets status to error and adds error class', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    (setIcon as jest.Mock).mockClear();
    finalizeSubagentBlock(state, 'Something failed', true);

    expect(state.info.status).toBe('error');
    expect(state.info.result).toBe('Something failed');
    expect((state.wrapperEl as any).hasClass('error')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'x');
  });

  it('keeps tool history and shows result section text', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    // Add a tool call first to populate content
    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'test.md' },
      status: 'running',
      isExpanded: false,
    });

    finalizeSubagentBlock(state, 'Done', false);

    const doneText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(doneText).toBe('Done');
  });

  it('shows ERROR text when isError is true', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    finalizeSubagentBlock(state, 'Error occurred', true);

    const errorText = getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')[0];
    expect(errorText).toBe('Error occurred');
  });

  it('does not restore a tool count badge after finalization', () => {
    const state = createSubagentBlock(parentEl as any, 'task-1', { description: 'Test task' });

    addSubagentToolCall(state, {
      id: 'tool-1',
      name: 'Read',
      input: {},
      status: 'running',
      isExpanded: false,
    });
    addSubagentToolCall(state, {
      id: 'tool-2',
      name: 'Grep',
      input: {},
      status: 'running',
      isExpanded: false,
    });

    finalizeSubagentBlock(state, 'Done', false);

    expect(getTextByClass(state.wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });
});

describe('renderStoredSubagent status variants', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  it('renders completed subagent with done class and check icon', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Completed task',
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    (setIcon as jest.Mock).mockClear();
    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect((wrapperEl as any).hasClass('done')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'check');
    const doneText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
    expect(doneText).toBe('Fertig.');
  });

  it('renders error subagent with error class and x icon', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Failed task',
      status: 'error',
      toolCalls: [],
      isExpanded: false,
    };

    (setIcon as jest.Mock).mockClear();
    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect((wrapperEl as any).hasClass('error')).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'x');
    const errorText = getTextByClass(wrapperEl as any, 'claudian-subagent-result-output')[0];
    expect(errorText).toBe('Fehlgeschlagen.');
  });

  it('renders running subagent with tool list', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Running task',
      status: 'running',
      toolCalls: [
        { id: 'tool-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed', isExpanded: false },
        { id: 'tool-2', name: 'Grep', input: { pattern: 'test' }, status: 'running', isExpanded: false },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    // Restored foreground work can no longer be running; show it as interrupted.
    expect((wrapperEl as any).hasClass('done')).toBe(false);
    expect((wrapperEl as any).hasClass('error')).toBe(true);
  });

  it('renders running subagent tool call with expanded-style result', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Running task',
      status: 'running',
      toolCalls: [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: 'test.md' },
          status: 'completed',
          result: 'File contents here',
          isExpanded: false,
        },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);
    const contentEl = (wrapperEl as any).querySelector('.claudian-subagent-content'); // content area

    // Should show result text
    const resultTexts = getTextByClass(contentEl, 'claudian-tool-line');
    expect(resultTexts.length).toBe(1);
    expect(resultTexts[0]).toContain('File contents here');
  });

  it('does not render a tool count badge for stored subagents', () => {
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: 'Task with tools',
      status: 'completed',
      toolCalls: [
        { id: 'tool-1', name: 'Read', input: {}, status: 'completed', isExpanded: false },
        { id: 'tool-2', name: 'Grep', input: {}, status: 'completed', isExpanded: false },
        { id: 'tool-3', name: 'Edit', input: {}, status: 'completed', isExpanded: false },
      ],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    expect(getTextByClass(wrapperEl as any, 'claudian-subagent-count')).toEqual([]);
  });

  // The title is no longer cut to 40 characters in code; CSS ellipsizes it to
  // the space the card has, and the full title stays available as a tooltip.
  it('keeps long descriptions whole and exposes them as the title', () => {
    const longDesc = 'A'.repeat(50);
    const subagent: SubagentInfo = {
      id: 'task-1',
      description: longDesc,
      status: 'completed',
      toolCalls: [],
      isExpanded: false,
    };

    const wrapperEl = renderStoredSubagent(parentEl as any, subagent);

    const labelEl = (wrapperEl as any).querySelector('.claudian-subagent-label');
    expect(labelEl.textContent).toBe(longDesc);
    expect(labelEl.getAttribute('title')).toBe(longDesc);
  });
});

describe('subagent card', () => {
  let parentEl: MockElement;

  beforeEach(() => {
    jest.clearAllMocks();
    parentEl = createMockEl('div');
  });

  const find = (el: MockElement, selector: string): MockElement => el.querySelector(selector) as MockElement;

  it('shows the agent type and the live activity line the provider reports', () => {
    const state = createSubagentBlock(parentEl as any, 'toolu_1', {
      description: 'Firewall prüfen',
      subagent_type: 'Explore',
    });
    state.info.activity = 'Durchsucht die FortiGate-Regeln';
    refreshSubagentCard(state);

    expect(find(state.wrapperEl as any, '.claudian-subagent-type').textContent).toBe('Explore');
    expect(find(state.wrapperEl as any, '.claudian-subagent-activity-text').textContent)
      .toBe('Durchsucht die FortiGate-Regeln');
    expect(state.wrapperEl.getAttribute('data-phase')).toBe('running');
  });

  it('offers Stop only while a live agent runs, and disables it once requested', () => {
    const state = createSubagentBlock(parentEl as any, 'toolu_1', { description: 'Task' });
    const stop = find(state.wrapperEl as any, '.claudian-subagent-action--stop') as any;

    expect(stop.hasClass('claudian-hidden')).toBe(false);

    state.info.cancelState = 'requested';
    refreshSubagentCard(state);
    expect(stop.disabled).toBe(true);
    expect(state.statusTextEl.textContent).toBe('Wird gestoppt');

    finalizeSubagentBlock(state, '[Request interrupted by user for tool use]', true);
    expect(state.wrapperEl.getAttribute('data-phase')).toBe('cancelled');
    expect(state.statusTextEl.textContent).toBe('Gestoppt');
    expect(stop.hasClass('claudian-hidden')).toBe(true);
  });

  // A card restored from history that was saved mid-run has no process behind it.
  it('never offers Stop on a restored card', () => {
    const wrapperEl = renderStoredSubagent(parentEl as any, {
      id: 'old', description: 'Alt', status: 'running', toolCalls: [], isExpanded: false,
    });

    expect(find(wrapperEl as any, '.claudian-subagent-action--stop').hasClass('claudian-hidden')).toBe(true);
    expect(find(wrapperEl as any, '.claudian-subagent-action--inspect')).not.toBeNull();
  });

  it('draws one trail step per tool call with its outcome', () => {
    const state = createSubagentBlock(parentEl as any, 'toolu_1', { description: 'Task' });
    addSubagentToolCall(state, { id: 't1', name: 'Read', input: {}, status: 'completed' });
    addSubagentToolCall(state, { id: 't2', name: 'Bash', input: {}, status: 'error' });
    addSubagentToolCall(state, { id: 't3', name: 'Grep', input: {}, status: 'running' });

    const steps = find(state.wrapperEl as any, '.claudian-subagent-trail').children;
    expect(steps.map(step => step.getAttribute('data-status'))).toEqual(['completed', 'error', 'running']);
  });

  it('lists model, mode and counters as facts', () => {
    const state = createAsyncSubagentBlock(parentEl as any, 'toolu_bg', { description: 'Hintergrund' });
    state.info.model = 'claude-haiku-4-5';
    state.info.totalTokens = 15853;
    state.info.toolUses = 3;
    refreshSubagentCard(state);

    const facts = find(state.wrapperEl as any, '.claudian-subagent-facts').children
      .map(fact => fact.children.map(part => part.textContent).join(': '));
    expect(facts).toEqual(['Modell: claude-haiku-4-5', 'Modus: Hintergrund', 'Werkzeuge: 3', 'Tokens: 15.853']);
  });

  it('says a stopped agent was stopped by the user when the provider gave no text', () => {
    const state = createSubagentBlock(parentEl as any, 'toolu_1', { description: 'Task' });
    state.info.cancelState = 'cancelled';
    state.info.status = 'error';
    refreshSubagentCard(state);

    expect(getTextByClass(state.contentEl as any, 'claudian-subagent-result-output')).toEqual(['Von dir gestoppt.']);
  });
});

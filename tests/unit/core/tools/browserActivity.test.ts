import {
  describeBrowserActivity,
  extractBrowserScreenshot,
  isBrowserActivityTool,
  resolveBrowserActivity,
} from '@/core/tools/browserActivity';

describe('resolveBrowserActivity', () => {
  describe('Hermes (ACP) tool names', () => {
    it('classifies navigate with its URL', () => {
      const activity = resolveBrowserActivity('browser_navigate', { url: 'https://veylor.net/shop' });
      expect(activity).toEqual({
        kind: 'browser',
        action: 'navigate',
        url: 'https://veylor.net/shop',
        target: undefined,
        driver: 'hermes',
      });
    });

    it.each([
      ['browser_click', { selector: '#buy' }, 'click', '#buy'],
      ['browser_type', { text: 'paper towels' }, 'type', 'paper towels'],
      ['browser_press', { key: 'Enter' }, 'press', 'Enter'],
      ['browser_scroll', { direction: 'down' }, 'scroll', 'down'],
      ['browser_back', {}, 'back', undefined],
      ['browser_snapshot', {}, 'snapshot', undefined],
      ['browser_vision', { question: 'Ist der Preis sichtbar?' }, 'vision', 'Ist der Preis sichtbar?'],
      ['browser_get_images', {}, 'images', undefined],
      ['browser_console', {}, 'console', undefined],
      ['browser_exec', { code: '# Searching Amazon\nnew_tab("https://amazon.de")' }, 'script', '# Searching Amazon'],
    ])('classifies %s', (name, input, action, target) => {
      const activity = resolveBrowserActivity(name, input);
      expect(activity?.kind).toBe('browser');
      expect(activity?.action).toBe(action);
      expect(activity?.target).toBe(target);
      expect(activity?.driver).toBe('hermes');
    });

    it('classifies computer_use as desktop automation with its action', () => {
      const activity = resolveBrowserActivity('computer_use', { action: 'click', app: 'Safari' });
      expect(activity).toEqual({
        kind: 'desktop',
        action: 'click',
        url: undefined,
        target: 'Safari',
        driver: 'hermes',
      });
    });
  });

  describe('Claude in Chrome (MCP)', () => {
    it('classifies navigate', () => {
      const activity = resolveBrowserActivity('mcp__claude-in-chrome__navigate', { url: 'https://github.com' });
      expect(activity?.kind).toBe('browser');
      expect(activity?.action).toBe('navigate');
      expect(activity?.url).toBe('https://github.com');
      expect(activity?.driver).toBe('claude-chrome');
    });

    it('maps the computer tool by its action argument', () => {
      expect(resolveBrowserActivity('mcp__claude-in-chrome__computer', { action: 'left_click' })?.action).toBe('click');
      expect(resolveBrowserActivity('mcp__claude-in-chrome__computer', { action: 'type', text: 'hi' })?.action).toBe('type');
      expect(resolveBrowserActivity('mcp__claude-in-chrome__computer', { action: 'screenshot' })?.action).toBe('snapshot');
      expect(resolveBrowserActivity('mcp__claude-in-chrome__computer', { action: 'scroll' })?.action).toBe('scroll');
      expect(resolveBrowserActivity('mcp__claude-in-chrome__computer', { action: 'key', text: 'Return' })?.action).toBe('press');
    });

    it.each([
      ['mcp__claude-in-chrome__read_page', 'snapshot'],
      ['mcp__claude-in-chrome__javascript_tool', 'script'],
      ['mcp__claude-in-chrome__read_console_messages', 'console'],
      ['mcp__claude-in-chrome__tabs_create_mcp', 'tab'],
      ['mcp__claude-in-chrome__tabs_close_mcp', 'tab'],
      ['mcp__claude-in-chrome__tabs_context_mcp', 'tab'],
      ['mcp__claude-in-chrome__gif_creator', 'record'],
    ])('classifies %s as %s', (name, action) => {
      expect(resolveBrowserActivity(name, {})?.action).toBe(action);
    });
  });

  describe('generic MCP browser servers (Codex / Playwright / Browser Use)', () => {
    it.each([
      ['mcp__playwright__browser_navigate', { url: 'https://example.com' }, 'navigate'],
      ['mcp__playwright__browser_click', { ref: 'e12', element: 'Login' }, 'click'],
      ['mcp__playwright__browser_take_screenshot', {}, 'snapshot'],
      ['mcp__playwright__browser_snapshot', {}, 'snapshot'],
      ['mcp__browser-use__browser_exec', { code: '# Open page\nx' }, 'script'],
      ['mcp__browser__browser_type', { text: 'abc' }, 'type'],
      ['mcp__chrome-devtools__navigate_page', { url: 'https://a.b' }, 'navigate'],
      ['mcp__chrome-devtools__take_screenshot', {}, 'snapshot'],
      ['mcp__chrome-devtools__click', { uid: '1' }, 'click'],
    ])('classifies %s as %s', (name, input, action) => {
      const activity = resolveBrowserActivity(name, input);
      expect(activity?.kind).toBe('browser');
      expect(activity?.action).toBe(action);
      expect(activity?.driver).toBe('mcp');
    });

    it('never classifies ordinary MCP tools', () => {
      expect(resolveBrowserActivity('mcp__github__create_issue', { title: 'x' })).toBeNull();
      expect(resolveBrowserActivity('mcp__canva__get_design', {})).toBeNull();
    });
  });

  it('never classifies ordinary tools, even with a url input', () => {
    expect(resolveBrowserActivity('WebFetch', { url: 'https://x.y' })).toBeNull();
    expect(resolveBrowserActivity('Bash', { command: 'open https://x.y' })).toBeNull();
    expect(resolveBrowserActivity('Read', {})).toBeNull();
  });
});

describe('isBrowserActivityTool', () => {
  it('is a cheap predicate over the same rules', () => {
    expect(isBrowserActivityTool('browser_click')).toBe(true);
    expect(isBrowserActivityTool('computer_use')).toBe(true);
    expect(isBrowserActivityTool('mcp__claude-in-chrome__navigate')).toBe(true);
    expect(isBrowserActivityTool('mcp__github__create_issue')).toBe(false);
    expect(isBrowserActivityTool('Bash')).toBe(false);
  });
});

describe('describeBrowserActivity', () => {
  it('produces German, human-readable labels with the target', () => {
    expect(describeBrowserActivity({ kind: 'browser', action: 'navigate', url: 'https://veylor.net/shop', target: undefined, driver: 'hermes' }))
      .toEqual({ title: 'Öffne Seite', detail: 'veylor.net/shop' });
    expect(describeBrowserActivity({ kind: 'browser', action: 'click', url: undefined, target: '#buy', driver: 'hermes' }))
      .toEqual({ title: 'Klicke', detail: '#buy' });
    expect(describeBrowserActivity({ kind: 'browser', action: 'type', url: undefined, target: 'paper towels', driver: 'hermes' }))
      .toEqual({ title: 'Tippe', detail: '„paper towels“' });
    expect(describeBrowserActivity({ kind: 'browser', action: 'snapshot', url: undefined, target: undefined, driver: 'mcp' }))
      .toEqual({ title: 'Lese Seite', detail: '' });
    expect(describeBrowserActivity({ kind: 'desktop', action: 'click', url: undefined, target: 'Safari', driver: 'hermes' }))
      .toEqual({ title: 'Klicke am Desktop', detail: 'Safari' });
  });

  it('truncates long targets', () => {
    const detail = describeBrowserActivity({ kind: 'browser', action: 'type', url: undefined, target: 'x'.repeat(200), driver: 'hermes' }).detail;
    expect(detail.length).toBeLessThanOrEqual(64);
  });
});

describe('extractBrowserScreenshot', () => {
  it('finds a data-url image in the result text', () => {
    const result = 'Screenshot captured\ndata:image/png;base64,iVBORw0KGgoAAAANSUhEUg==\nmore';
    expect(extractBrowserScreenshot(result)).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  });

  it('finds a screenshot file path in Browser-Use / Hermes results', () => {
    expect(extractBrowserScreenshot('saved: /tmp/bh/shot-1.png done')).toBe('/tmp/bh/shot-1.png');
    expect(extractBrowserScreenshot('{"screenshot_path": "/Users/x/.hermes/shots/a.jpg"}')).toBe('/Users/x/.hermes/shots/a.jpg');
  });

  it('returns null when there is no image', () => {
    expect(extractBrowserScreenshot('Clicked element #buy')).toBeNull();
    expect(extractBrowserScreenshot(undefined)).toBeNull();
  });
});

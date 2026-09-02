/**
 * Browser / desktop automation detection across providers.
 *
 * Every provider surfaces "the agent is driving a browser" under a different
 * tool name:
 *   - Hermes (ACP): `browser_navigate`, `browser_click`, …, `browser_exec`
 *     (Browser Use CLI) and `computer_use` (cua-driver on the desktop).
 *   - Claude Code: the Claude-in-Chrome MCP server, `mcp__claude-in-chrome__*`,
 *     whose `computer` tool multiplexes clicks/typing/screenshots via `action`.
 *   - Codex / OpenCode / others: whatever MCP browser server is configured
 *     (Playwright MCP `mcp__playwright__browser_*`, Chrome DevTools MCP,
 *     Browser Use MCP). Detected by server name and/or tool verb.
 *
 * This module turns all of them into one small vocabulary so the chat UI can
 * render one browser card and one live status chip, instead of a generic
 * wrench icon labelled `mcp__claude-in-chrome__computer`.
 */

export type BrowserActivityKind = 'browser' | 'desktop';

export type BrowserActivityAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'press'
  | 'scroll'
  | 'back'
  | 'snapshot'
  | 'vision'
  | 'images'
  | 'console'
  | 'script'
  | 'tab'
  | 'record'
  | 'wait'
  | 'other';

export type BrowserActivityDriver = 'hermes' | 'claude-chrome' | 'mcp';

export interface BrowserActivity {
  kind: BrowserActivityKind;
  action: BrowserActivityAction;
  /** Page URL when the call carries one (navigate / tab open). */
  url: string | undefined;
  /** Human target: selector, typed text, key, question, app name, script label. */
  target: string | undefined;
  driver: BrowserActivityDriver;
}

const HERMES_BROWSER_TOOLS: Record<string, BrowserActivityAction> = {
  browser_navigate: 'navigate',
  browser_click: 'click',
  browser_type: 'type',
  browser_press: 'press',
  browser_scroll: 'scroll',
  browser_back: 'back',
  browser_snapshot: 'snapshot',
  browser_vision: 'vision',
  browser_get_images: 'images',
  browser_console: 'console',
  browser_exec: 'script',
  browser_cdp: 'script',
  browser_dialog: 'other',
  browser_auth: 'other',
};

const CLAUDE_CHROME_TOOLS: Record<string, BrowserActivityAction> = {
  navigate: 'navigate',
  read_page: 'snapshot',
  javascript_tool: 'script',
  read_console_messages: 'console',
  tabs_create_mcp: 'tab',
  tabs_close_mcp: 'tab',
  tabs_context_mcp: 'tab',
  gif_creator: 'record',
  // `computer` is resolved from its `action` argument.
};

/** MCP server names that are browser/desktop drivers regardless of tool verb. */
const BROWSER_MCP_SERVER_PATTERN = /^(claude-in-chrome|playwright|browser(?:[-_]use)?|browserbase|chrome(?:[-_]devtools)?|puppeteer|stagehand|computer(?:[-_]use)?)$/i;

/** Tool verbs that mark a browser action even on an unknown server name. */
const BROWSER_VERB_PATTERN = /^browser_/i;

function stringInput(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function firstLine(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line || undefined;
}

/** Maps Anthropic computer-use style `action` values onto our vocabulary. */
function actionFromComputerAction(action: string | undefined): BrowserActivityAction {
  const value = (action ?? '').toLowerCase();
  if (!value) return 'other';
  if (/click/.test(value)) return 'click';
  if (/^type|typing|set_value/.test(value)) return 'type';
  if (/^key|press|hotkey/.test(value)) return 'press';
  if (/scroll/.test(value)) return 'scroll';
  if (/screenshot|capture|zoom/.test(value)) return 'snapshot';
  if (/drag|mouse_move|move/.test(value)) return 'other';
  if (/wait/.test(value)) return 'wait';
  if (/navigate|goto|open/.test(value)) return 'navigate';
  if (/focus|list_apps|list_windows/.test(value)) return 'tab';
  return 'other';
}

/** Maps a generic MCP browser tool verb (after the server prefix) onto our vocabulary. */
function actionFromVerb(verb: string): BrowserActivityAction {
  const value = verb.toLowerCase().replace(/^browser_/, '');
  if (/^(navigate|navigate_page|goto|open|open_url|new_page|visit)/.test(value)) return 'navigate';
  if (/back|forward/.test(value)) return 'back';
  if (/click|tap|select_option|choose|hover|drag/.test(value)) return 'click';
  if (/type|fill|input|set_value|press_sequentially/.test(value)) return 'type';
  if (/^press|key/.test(value)) return 'press';
  if (/scroll/.test(value)) return 'scroll';
  if (/screenshot|snapshot|read_page|get_text|extract|accessibility|read/.test(value)) return 'snapshot';
  if (/vision|analy[sz]e|describe/.test(value)) return 'vision';
  if (/image/.test(value)) return 'images';
  if (/console|network|log/.test(value)) return 'console';
  if (/exec|evaluate|script|javascript|run_code|cdp/.test(value)) return 'script';
  if (/tab|window|page_list|list_pages|select_page|close/.test(value)) return 'tab';
  if (/record|gif|video|trace/.test(value)) return 'record';
  if (/wait|sleep/.test(value)) return 'wait';
  return 'other';
}

function targetFor(action: BrowserActivityAction, input: Record<string, unknown>): string | undefined {
  switch (action) {
    case 'click':
      return stringInput(input, 'selector', 'element', 'ref', 'uid', 'text', 'label', 'coordinate', 'app');
    case 'type':
      return stringInput(input, 'text', 'value', 'query');
    case 'press':
      return stringInput(input, 'key', 'keys', 'text');
    case 'scroll':
      return stringInput(input, 'direction', 'selector');
    case 'vision':
      return stringInput(input, 'question', 'prompt');
    case 'script':
      return firstLine(stringInput(input, 'code', 'script', 'expression', 'function'));
    case 'tab':
      return stringInput(input, 'url', 'app', 'title', 'tabId', 'tab_id', 'pageId');
    default:
      return stringInput(input, 'app', 'selector');
  }
}

function build(
  kind: BrowserActivityKind,
  action: BrowserActivityAction,
  input: Record<string, unknown>,
  driver: BrowserActivityDriver,
): BrowserActivity {
  return {
    kind,
    action,
    url: stringInput(input, 'url', 'href'),
    target: targetFor(action, input),
    driver,
  };
}

/**
 * Classifies a tool call as browser/desktop automation, or returns null when
 * the tool is unrelated. Deliberately name-driven: a `url` argument on
 * `WebFetch` or `Bash` is not browsing.
 */
export function resolveBrowserActivity(
  toolName: string,
  input: Record<string, unknown> = {},
): BrowserActivity | null {
  const name = toolName.trim();
  if (!name) return null;

  if (name === 'computer_use') {
    return build('desktop', actionFromComputerAction(stringInput(input, 'action')), input, 'hermes');
  }

  const hermesAction = HERMES_BROWSER_TOOLS[name];
  if (hermesAction) {
    return build('browser', hermesAction, input, 'hermes');
  }

  const mcpMatch = /^mcp__([^_]+(?:[-_][^_]+)*?)__(.+)$/.exec(name);
  if (!mcpMatch) return null;
  const [, server, verb] = mcpMatch;

  if (server.toLowerCase() === 'claude-in-chrome') {
    if (verb === 'computer') {
      return build('browser', actionFromComputerAction(stringInput(input, 'action')), input, 'claude-chrome');
    }
    return build('browser', CLAUDE_CHROME_TOOLS[verb] ?? actionFromVerb(verb), input, 'claude-chrome');
  }

  const isBrowserServer = BROWSER_MCP_SERVER_PATTERN.test(server);
  const isBrowserVerb = BROWSER_VERB_PATTERN.test(verb);
  if (!isBrowserServer && !isBrowserVerb) return null;

  const kind: BrowserActivityKind = /^computer/i.test(server) ? 'desktop' : 'browser';
  if (verb === 'computer' || verb === 'computer_use') {
    return build(kind, actionFromComputerAction(stringInput(input, 'action')), input, 'mcp');
  }
  return build(kind, actionFromVerb(verb), input, 'mcp');
}

export function isBrowserActivityTool(toolName: string): boolean {
  return resolveBrowserActivity(toolName) !== null;
}

const MAX_DETAIL = 64;

function truncate(value: string, max = MAX_DETAIL): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** `https://veylor.net/shop?x=1` → `veylor.net/shop` — the part a human reads. */
export function formatBrowserUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return truncate(`${parsed.host}${path}`);
  } catch {
    return truncate(url);
  }
}

const ACTION_TITLES: Record<BrowserActivityAction, string> = {
  navigate: 'Öffne Seite',
  click: 'Klicke',
  type: 'Tippe',
  press: 'Drücke Taste',
  scroll: 'Scrolle',
  back: 'Gehe zurück',
  snapshot: 'Lese Seite',
  vision: 'Betrachte Seite',
  images: 'Sammle Bilder',
  console: 'Lese Konsole',
  script: 'Führe Skript aus',
  tab: 'Wechsle Tab',
  record: 'Nehme auf',
  wait: 'Warte',
  other: 'Steuere Browser',
};

const DESKTOP_TITLES: Partial<Record<BrowserActivityAction, string>> = {
  click: 'Klicke am Desktop',
  type: 'Tippe am Desktop',
  press: 'Drücke Taste',
  scroll: 'Scrolle am Desktop',
  snapshot: 'Erfasse Bildschirm',
  tab: 'Wechsle App',
  wait: 'Warte',
  other: 'Steuere Desktop',
};

/** German status-bar / card copy for an activity. */
export function describeBrowserActivity(activity: BrowserActivity): { title: string; detail: string } {
  const title = activity.kind === 'desktop'
    ? (DESKTOP_TITLES[activity.action] ?? DESKTOP_TITLES.other ?? 'Steuere Desktop')
    : ACTION_TITLES[activity.action];

  let detail = '';
  if (activity.action === 'navigate' || (activity.action === 'tab' && activity.url)) {
    detail = formatBrowserUrl(activity.url);
  } else if (activity.action === 'type' && activity.target) {
    detail = `„${truncate(activity.target, MAX_DETAIL - 2)}“`;
  } else if (activity.target) {
    detail = truncate(activity.target);
  }
  return { title, detail };
}

const DATA_URL_PATTERN = /data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/;
const IMAGE_PATH_PATTERN = /(?:^|["'\s:=(])((?:\/|~\/|[A-Za-z]:\\)[^"'\s)]+?\.(?:png|jpe?g|webp|gif))(?=$|["'\s)])/im;

/**
 * Finds a screenshot in a tool result: inline data-URL first, then a file path
 * (Browser Use CLI prints `capture_screenshot()` paths; Hermes desktop capture
 * returns `screenshot_path`). Returns null when the result carries no image.
 */
export function extractBrowserScreenshot(result: string | undefined): string | null {
  if (!result) return null;
  const dataUrl = DATA_URL_PATTERN.exec(result)?.[0];
  if (dataUrl) return dataUrl;
  const path = IMAGE_PATH_PATTERN.exec(result)?.[1];
  return path ?? null;
}

import { setIcon } from 'obsidian';

import { describeBrowserActivity, resolveBrowserActivity } from '../../../core/tools/browserActivity';
import type { TodoItem } from '../../../core/tools/todo';
import { getToolIcon, MCP_ICON_MARKER } from '../../../core/tools/toolIcons';
import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isAgentLifecycleTool,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { AskUserQuestionItem, AskUserQuestionOption, ToolCallInfo } from '../../../core/types';
import type { DiffStats } from '../../../core/types/diff';
import { appendMcpIcon } from '../../../shared/icons';
import { parseApplyPatchDiffs, parseFileUpdateChangeDiffs } from '../../../utils/diff';
import { renderFileActionPill, showFileContextMenu } from '../services/FileActionService';
import { renderFileFormatBadge } from '../ui/file-drop/fileFormatIcons';
import {
  decorateBrowserToolElement,
  getBrowserActionIcon,
  renderBrowserContent,
} from './BrowserActivityRenderer';
import { setupCollapsible } from './collapsible';
import { renderDiffContent, renderDiffStats } from './DiffRenderer';
import {
  decorateMediaToolElement,
  describeMediaActivity,
  isMediaToolName,
  renderMediaContent,
  resolveMediaActivity,
} from './MediaActivityRenderer';
import { renderTodoItems } from './todoUtils';

export function setToolIcon(el: HTMLElement, name: string, input: Record<string, unknown> = {}): void {
  const safeInput = input ?? {};
  const browserActivity = resolveBrowserActivity(name, safeInput);
  if (browserActivity) {
    setIcon(el, getBrowserActionIcon(browserActivity));
    return;
  }
  const mediaActivity = resolveMediaActivity(name, safeInput);
  if (mediaActivity) {
    setIcon(el, describeMediaActivity(mediaActivity).icon);
    return;
  }
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    appendMcpIcon(el);
  } else {
    setIcon(el, icon);
  }
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getInputText(input: Record<string, unknown> | null | undefined, key: string, fallback = ''): string {
  if (!input) return fallback;
  return stringifyToolValue(input[key]) || fallback;
}

export function getToolName(name: string, input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  const mediaActivity = resolveMediaActivity(name, safeInput);
  if (mediaActivity && (isMediaToolName(name) || (name === TOOL_READ && mediaActivity.kind !== 'pdf'))) {
    return describeMediaActivity(mediaActivity).title;
  }

  switch (name) {
    case TOOL_TODO_WRITE: {
      const todos = safeInput.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks ${completed}/${todos.length}`;
      }
      return 'Tasks';
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Betrete Plan-Modus';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan fertig';
    default: {
      const browserActivity = resolveBrowserActivity(name, safeInput);
      if (browserActivity) return describeBrowserActivity(browserActivity).title;
      return name;
    }
  }
}

export function getToolSummary(name: string, input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  const mediaActivity = resolveMediaActivity(name, safeInput);
  if (mediaActivity && isMediaToolName(name)) {
    return describeMediaActivity(mediaActivity).detail;
  }

  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = getInputText(safeInput, 'file_path')
        || getInputText(safeInput, 'target_file')
        || getInputText(safeInput, 'targetFile')
        || getInputText(safeInput, 'path')
        || getInputText(safeInput, 'absolute_path')
        || getInputText(safeInput, 'FilePath')
        || getInputText(safeInput, 'AbsolutePath');
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = getInputText(safeInput, 'command');
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return getInputText(safeInput, 'pattern');
    case TOOL_WEB_SEARCH:
      return getWebSearchSummary(safeInput, 60);
    case TOOL_WEB_FETCH:
      return truncateText(getInputText(safeInput, 'url'), 60);
    case TOOL_LS:
      return fileNameOnly(getInputText(safeInput, 'path', '.'));
    case TOOL_SKILL:
      return getInputText(safeInput, 'skill');
    case TOOL_TOOL_SEARCH:
      return truncateText(parseToolSearchQuery(getInputText(safeInput, 'query')), 60);
    case TOOL_TODO_WRITE:
      return '';
    case 'Ergebnis':
      return truncateText(getInputText(safeInput, 'summary'), 60);
    case TOOL_APPLY_PATCH:
      return getApplyPatchSummary(safeInput);
    case TOOL_WRITE_STDIN:
      return getWriteStdinSummary(safeInput);
    default: {
      if (isAgentLifecycleTool(name)) {
        return getAgentLifecycleSummary(name, safeInput);
      }
      const browserActivity = resolveBrowserActivity(name, safeInput);
      if (browserActivity) return describeBrowserActivity(browserActivity).detail;

      // Smart extraction for CLI, MCP, and Antigravity tools
      const pattern = getInputText(safeInput, "Pattern") || getInputText(safeInput, "pattern");
      const searchDir = getInputText(safeInput, "SearchDirectory") || getInputText(safeInput, "directory") || getInputText(safeInput, "SearchPath");
      if (pattern && searchDir) {
        return truncateText(`${pattern} in ${shortenPath(searchDir)}`, 60);
      }
      if (pattern) {
        return truncateText(pattern, 60);
      }

      const query = getInputText(safeInput, "Query") || getInputText(safeInput, "query");
      if (query && searchDir) {
        return truncateText(`"${query}" in ${shortenPath(searchDir)}`, 60);
      }
      if (query) {
        return truncateText(`"${query}"`, 60);
      }

      const cmd = getInputText(safeInput, "CommandLine") || (name !== TOOL_BASH ? getInputText(safeInput, "command") : "");
      if (cmd) {
        return truncateText(cmd, 60);
      }

      const dirPath = getInputText(safeInput, "DirectoryPath");
      if (dirPath) {
        return truncateText(shortenPath(dirPath), 60);
      }

      const filePath = getInputText(safeInput, "absolute_path") || getInputText(safeInput, "target_file");
      if (filePath) {
        return fileNameOnly(filePath) || truncateText(shortenPath(filePath), 60);
      }

      const toolAction = getInputText(safeInput, "toolAction");
      const toolSummary = getInputText(safeInput, "toolSummary");
      if (toolAction && toolSummary && toolAction !== toolSummary) {
        return truncateText(`${toolAction} (${toolSummary})`, 60);
      }
      if (toolSummary) return truncateText(toolSummary, 60);
      if (toolAction) return truncateText(toolAction, 60);

      const url = getInputText(safeInput, "url") || getInputText(safeInput, "Url");
      if (url) return truncateText(url, 60);

      const prompt = getInputText(safeInput, "Prompt") || getInputText(safeInput, "prompt");
      if (prompt) return truncateText(prompt, 60);

      return "";
    }
  }
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  const mediaActivity = resolveMediaActivity(name, safeInput);
  if (mediaActivity && isMediaToolName(name)) {
    const { title, detail } = describeMediaActivity(mediaActivity);
    return `${title}: ${detail}`;
  }

  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(getInputText(safeInput, 'file_path')) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(getInputText(safeInput, 'file_path')) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(getInputText(safeInput, 'file_path')) || 'file'}`;
    case TOOL_BASH: {
      const cmd = getInputText(safeInput, 'command', 'command');
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${getInputText(safeInput, 'pattern', 'files')}`;
    case TOOL_GREP:
      return `Grep: ${getInputText(safeInput, 'pattern', 'pattern')}`;
    case TOOL_WEB_SEARCH: {
      return getWebSearchLabel(safeInput, 40);
    }
    case TOOL_WEB_FETCH: {
      const url = getInputText(safeInput, 'url', 'url');
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(getInputText(safeInput, 'path')) || '.'}`;
    case TOOL_TODO_WRITE: {
      const todos = safeInput.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return 'Tasks';
    }
    case TOOL_SKILL: {
      const skillName = getInputText(input, 'skill', 'skill');
      return `Skill: ${skillName}`;
    }
    case TOOL_TOOL_SEARCH: {
      const tools = parseToolSearchQuery(getInputText(input, 'query'));
      return `ToolSearch: ${tools || 'tools'}`;
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Betrete Plan-Modus';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan fertig';
    case 'Ergebnis':
      return input.summary ? `Ergebnis: ${String(input.summary).slice(0, 40)}` : 'Ergebnis';
    case TOOL_APPLY_PATCH: {
      const summary = getApplyPatchSummary(input);
      return summary ? `apply_patch: ${summary}` : 'apply_patch';
    }
    case TOOL_WRITE_STDIN: {
      const summary = getWriteStdinSummary(input);
      return summary ? `write_stdin: ${summary}` : 'write_stdin';
    }
    default: {
      if (isAgentLifecycleTool(name)) {
        const summary = getAgentLifecycleSummary(name, input);
        return summary ? `${name}: ${summary}` : name;
      }
      const summary = getToolSummary(name, input);
      return summary ? `${name}: ${summary}` : name;
    }
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function getApplyPatchSummary(input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  // Extract file paths from patch text markers
  const patchText = typeof safeInput.patch === 'string' ? safeInput.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(m => m[1]?.trim() ?? '');

  // Also check changes array
  const changes = safeInput.changes;
  const changeFiles = Array.isArray(changes)
    ? (changes as Array<{ path?: string }>)
        .map(c => c.path)
        .filter((p): p is string => !!p)
    : [];

  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return fileNameOnly(files[0]);
  return `${files.length} files`;
}

function getWriteStdinSummary(input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  const sessionId = stringifyToolValue(safeInput.session_id ?? safeInput.sessionId);
  const chars = typeof safeInput.chars === 'string' ? safeInput.chars.replace(/\n/g, '\\n') : '';
  if (chars) {
    const preview = chars.length > 24 ? `${chars.slice(0, 24)}...` : chars;
    return sessionId ? `#${sessionId} ${preview}` : preview;
  }
  return sessionId ? `#${sessionId}` : '';
}

function getAgentLifecycleSummary(name: string, input: Record<string, unknown> = {}): string {
  const safeInput = input ?? {};
  switch (name) {
    case 'spawn_agent': {
      const msg = typeof safeInput.message === 'string' ? safeInput.message : '';
      return msg.length > 50 ? `${msg.slice(0, 50)}...` : msg;
    }
    case 'send_input': {
      const msg = typeof safeInput.message === 'string' ? safeInput.message : '';
      return msg.length > 40 ? `${msg.slice(0, 40)}...` : msg;
    }
    case 'wait': {
      const ids = Array.isArray(safeInput.ids) ? safeInput.ids.length : 0;
      const timeoutMs = typeof safeInput.timeout_ms === 'number' ? safeInput.timeout_ms : undefined;
      const parts: string[] = [];
      if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
      if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
      return parts.join(', ');
    }
    case 'resume_agent':
    case 'close_agent':
      return '';
    default:
      return '';
  }
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function parseToolSearchQuery(query: string | undefined): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

interface WebSearchLink {
  title: string;
  url: string;
}

interface WebSearchDisplayData {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
}

function normalizeWebSearchDisplayData(input: Record<string, unknown> = {}): WebSearchDisplayData {
  const safeInput = input ?? {};
  const queries = Array.isArray(safeInput.queries)
    ? safeInput.queries
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim())
    : [];

  const query = typeof safeInput.query === 'string' && safeInput.query.trim()
    ? safeInput.query.trim()
    : queries[0] ?? '';
  const url = typeof safeInput.url === 'string' && safeInput.url.trim() ? safeInput.url.trim() : '';
  const pattern = typeof safeInput.pattern === 'string' && safeInput.pattern.trim() ? safeInput.pattern.trim() : '';

  const explicitActionType = typeof safeInput.actionType === 'string' && safeInput.actionType.trim()
    ? safeInput.actionType.trim()
    : '';
  const actionType = explicitActionType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  return { actionType, query, queries, url, pattern };
}

function getWebSearchSummary(input: Record<string, unknown> = {}, maxLength: number): string {
  const data = normalizeWebSearchDisplayData(input);

  switch (data.actionType) {
    case 'open_page':
      return truncateText(`Open ${data.url || 'page'}`, maxLength);
    case 'find_in_page': {
      const target = data.pattern ? `Suche "${data.pattern}"` : 'Auf Seite suchen';
      const suffix = data.url ? ` in ${data.url}` : '';
      return truncateText(target + suffix, maxLength);
    }
    case 'search':
      return truncateText(data.query || data.queries[0] || '', maxLength);
    default:
      return truncateText(data.query || data.url || data.pattern || '', maxLength);
  }
}

function getWebSearchLabel(input: Record<string, unknown> = {}, maxLength: number): string {
  const summary = getWebSearchSummary(input, maxLength);
  return `WebSearch: ${summary || 'search'}`;
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function appendToolLink(parent: HTMLElement, title: string, url: string): void {
  const linkEl = parent.createEl('a', { cls: 'claudian-tool-link' });
  linkEl.setAttribute('href', url);
  linkEl.setAttribute('target', '_blank');
  linkEl.setAttribute('rel', 'noopener noreferrer');

  const iconEl = linkEl.createSpan({ cls: 'claudian-tool-link-icon' });
  setIcon(iconEl, 'external-link');

  const copy = linkEl.createDiv({ cls: 'claudian-web-result-copy' });
  copy.createSpan({ cls: 'claudian-web-result-domain', text: getUrlHost(url) });
  copy.createSpan({ cls: 'claudian-tool-link-title', text: title });
}

function isPlaceholderWebSearchResult(result: string | undefined): boolean {
  if (!result) return true;
  const normalized = result.trim().toLowerCase();
  return normalized === '' || normalized === 'search complete';
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

function renderWebSearchActionExpanded(container: HTMLElement, input: Record<string, unknown>): boolean {
  const data = normalizeWebSearchDisplayData(input);
  const hasStructuredData = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern);
  if (!hasStructuredData) {
    return false;
  }

  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });

  switch (data.actionType) {
    case 'open_page':
      linesEl.createDiv({ cls: 'claudian-tool-line', text: 'Seite öffnen' });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'claudian-tool-line', text: 'URL nicht verfügbar' });
      }
      return true;

    case 'find_in_page':
      linesEl.createDiv({ cls: 'claudian-tool-line', text: 'Auf Seite suchen' });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'claudian-tool-line', text: 'URL nicht verfügbar' });
      }
      if (data.pattern) {
        linesEl.createDiv({ cls: 'claudian-tool-line', text: `Muster: ${data.pattern}` });
      }
      return true;

    case 'search':
    default: {
      const primaryQuery = data.query || data.queries[0];
      linesEl.createDiv({
        cls: 'claudian-tool-line',
        text: primaryQuery ? `Suche: ${primaryQuery}` : 'Websuche',
      });

      const alternateQueries = data.queries.filter(query => query !== primaryQuery);
      for (const query of alternateQueries.slice(0, 4)) {
        linesEl.createDiv({ cls: 'claudian-tool-line', text: `Alternative: ${query}` });
      }
      if (alternateQueries.length > 4) {
        linesEl.createDiv({
          cls: 'claudian-tool-truncated',
          text: `... ${alternateQueries.length - 4} more queries`,
        });
      }
      return true;
    }
  }
}

function renderWebSearchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  // Web search badge with spinning globe icon
  const badgeEl = container.createDiv({
    cls: `claudian-tool-web-badge${result ? ' is-done' : ''}`,
  });
  setIcon(badgeEl.createSpan(), 'globe');
  badgeEl.createSpan({ text: result ? 'Websuche fertig' : 'Suche im Web…' });

  const queryHint = normalizeWebSearchDisplayData(input).query;
  if (queryHint) {
    container.createDiv({ cls: 'claudian-web-query', text: queryHint });
  }

  const parsed = result ? parseWebSearchResult(result) : null;
  if (parsed && parsed.links.length > 0) {
    const linksEl = container.createDiv({ cls: 'claudian-tool-lines claudian-web-results' });
    for (const link of parsed.links) {
      appendToolLink(linksEl, link.title, link.url);
    }

    if (parsed.summary) {
      const summaryEl = container.createDiv({ cls: 'claudian-tool-web-summary' });
      summaryEl.setText(parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary);
    }
    return;
  }

  const data = normalizeWebSearchDisplayData(input);
  const shouldRenderAction = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern)
    && (!result
      || isPlaceholderWebSearchResult(result)
      || data.actionType === 'open_page'
      || data.actionType === 'find_in_page');

  if (shouldRenderAction && renderWebSearchActionExpanded(container, input)) {
    if (result && !isPlaceholderWebSearchResult(result)) {
      renderLinesExpanded(container, result, 12);
    }
    return;
  }

  if (result) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  if (renderWebSearchActionExpanded(container, input)) {
    return;
  }

  container.createDiv({ cls: 'claudian-tool-empty', text: 'Kein Ergebnis' });
}

interface SearchMatchItem {
  file: string;
  line?: number;
  snippet?: string;
}

function parseSearchOutput(result: string): { isStructured: boolean; isGrep: boolean; matches: SearchMatchItem[] } {
  try {
    const parsed = JSON.parse(result);
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.results) ? parsed.results : null);
    if (arr && arr.length > 0) {
      const matches: SearchMatchItem[] = arr.map((item: any) => ({
        file: String(item.Filename || item.filename || item.file || item.path || item.filePath || item.target_file || ''),
        line: typeof item.LineNumber === 'number' ? item.LineNumber : (typeof item.line === 'number' ? item.line : undefined),
        snippet: typeof item.LineContent === 'string' ? item.LineContent : (typeof item.snippet === 'string' ? item.snippet : (typeof item.content === 'string' ? item.content : undefined)),
      })).filter((m: SearchMatchItem) => Boolean(m.file));

      if (matches.length > 0) {
        return { isStructured: true, isGrep: matches.some(m => m.line !== undefined), matches };
      }
    }
  } catch {
    // Plaintext fallback
  }

  const lines = result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { isStructured: false, isGrep: false, matches: [] };
  }

  const grepMatches: SearchMatchItem[] = [];
  const fileMatches: SearchMatchItem[] = [];

  for (const line of lines) {
    const gm = line.match(/^([^:\r\n]+):(\d+):(.*)$/);
    if (gm) {
      grepMatches.push({
        file: gm[1].trim(),
        line: parseInt(gm[2], 10),
        snippet: gm[3].trim(),
      });
      continue;
    }
    if (/^[a-zA-Z0-9_.\-\\/]+\.[a-zA-Z0-9]+(?::\d+)?$/.test(line)) {
      fileMatches.push({ file: line });
    }
  }

  if (grepMatches.length > 0 && grepMatches.length >= lines.length * 0.4) {
    return { isStructured: true, isGrep: true, matches: grepMatches };
  }

  if (fileMatches.length > 0 && fileMatches.length >= lines.length * 0.5) {
    return { isStructured: true, isGrep: false, matches: fileMatches };
  }

  return { isStructured: false, isGrep: false, matches: [] };
}

function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const parsed = parseSearchOutput(result);
  if (!parsed.isStructured || parsed.matches.length === 0) {
    const lines = result.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) {
      container.createDiv({ cls: 'claudian-tool-empty', text: 'Keine Treffer' });
      return;
    }
    renderLinesExpanded(container, result, 15, true);
    return;
  }

  const app = (window as unknown as { app?: any }).app;
  const panel = container.createDiv({ cls: 'claudian-search-panel' });

  const header = panel.createDiv({ cls: 'claudian-search-summary-header' });
  const totalCount = parsed.matches.length;
  const uniqueFiles = new Set(parsed.matches.map(m => m.file)).size;

  const countBadge = header.createSpan({ cls: 'claudian-search-count-badge' });
  setIcon(countBadge.createSpan(), parsed.isGrep ? 'search' : 'folder');
  countBadge.createSpan({
    text: parsed.isGrep
      ? `${totalCount} ${totalCount === 1 ? 'Treffer' : 'Treffer'} in ${uniqueFiles} ${uniqueFiles === 1 ? 'Datei' : 'Dateien'}`
      : `${totalCount} ${totalCount === 1 ? 'Datei' : 'Dateien'} gefunden`
  });

  if (parsed.isGrep) {
    const grouped = new Map<string, SearchMatchItem[]>();
    for (const m of parsed.matches) {
      const list = grouped.get(m.file) || [];
      list.push(m);
      grouped.set(m.file, list);
    }

    for (const [filePath, fileMatches] of grouped) {
      const fileGroup = panel.createDiv({ cls: 'claudian-search-file-group' });
      const fileHeader = fileGroup.createDiv({ cls: 'claudian-search-file-header' });

      const iconSpan = fileHeader.createSpan({ cls: 'claudian-search-file-icon' });
      renderFileFormatBadge(iconSpan, filePath);

      fileHeader.createSpan({ cls: 'claudian-search-file-name', text: filePath });

      fileHeader.createSpan({
        cls: 'claudian-search-file-badge',
        text: `${fileMatches.length}`
      });

      if (app) {
        fileHeader.addClass('is-clickable');
        fileHeader.setAttribute('title', 'In Obsidian öffnen');
        fileHeader.addEventListener('click', (e) => {
          e.stopPropagation();
          void app.workspace.openLinkText(filePath, '', false);
        });
      }

      const matchesList = fileGroup.createDiv({ cls: 'claudian-search-matches-list' });
      const maxMatches = 6;
      const displayMatches = fileMatches.slice(0, maxMatches);

      for (const match of displayMatches) {
        const row = matchesList.createDiv({ cls: 'claudian-search-match-row' });
        if (match.line !== undefined) {
          row.createSpan({ cls: 'claudian-search-line-chip', text: `:${match.line}` });
        }
        row.createSpan({ cls: 'claudian-search-snippet', text: match.snippet || ' ' });

        if (app && match.line !== undefined) {
          row.addClass('is-clickable');
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            void app.workspace.openLinkText(filePath, '', false);
          });
        }
      }

      if (fileMatches.length > maxMatches) {
        matchesList.createDiv({
          cls: 'claudian-tool-truncated',
          text: `… + ${fileMatches.length - maxMatches} weitere Treffer in dieser Datei`
        });
      }
    }
  } else {
    const grid = panel.createDiv({ cls: 'claudian-file-chips-grid' });
    const maxFiles = 30;
    const displayFiles = parsed.matches.slice(0, maxFiles);

    for (const match of displayFiles) {
      const chip = grid.createDiv({ cls: 'claudian-file-chip' });
      const iconSpan = chip.createSpan({ cls: 'claudian-file-chip-icon' });
      renderFileFormatBadge(iconSpan, match.file);

      const parts = match.file.split(/[\\/]/);
      const fileName = parts.pop() || match.file;
      const dir = parts.join('/');

      chip.createSpan({ cls: 'claudian-file-chip-name', text: fileName });
      if (dir) {
        chip.createSpan({ cls: 'claudian-file-chip-dir', text: dir });
      }

      if (app) {
        chip.addClass('is-clickable');
        chip.setAttribute('title', 'In Obsidian öffnen');
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          void app.workspace.openLinkText(match.file, '', false);
        });
      }
    }

    if (parsed.matches.length > maxFiles) {
      panel.createDiv({
        cls: 'claudian-tool-truncated',
        text: `… + ${parsed.matches.length - maxFiles} weitere Dateien`
      });
    }
  }
}

function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  let isExpanded = false;

  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  const render = () => {
    linesEl.empty();
    const displayLines = (!isExpanded && truncated) ? lines.slice(0, maxLines) : lines;
    for (const line of displayLines) {
      const stripped = line.replace(/^\s*\d+→/, '');
      const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line' });
      if (hoverable) lineEl.addClass('hoverable');

      if (/^\s*(?:error|err!|failed|fatal:|exception:)/i.test(stripped)) {
        lineEl.addClass('claudian-tool-line-error');
      } else if (/^\s*(?:warn|warning:)/i.test(stripped)) {
        lineEl.addClass('claudian-tool-line-warn');
      } else if (/^\s*(?:success|done|completed|passed)/i.test(stripped)) {
        lineEl.addClass('claudian-tool-line-success');
      }

      lineEl.setText(stripped || ' ');
    }

    if (truncated) {
      const toggleEl = linesEl.createEl('button', {
        cls: 'claudian-tool-expand-btn',
        attr: { type: 'button' }
      });
      toggleEl.setText(isExpanded ? '▲ Weniger Zeilen anzeigen' : `▼ + ${lines.length - maxLines} weitere Zeilen anzeigen`);
      toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        render();
      });
    }
  };
  render();
}

function renderToolSearchExpanded(container: HTMLElement, result: string): void {
  let toolNames: string[] = [];
  try {
    const parsed = JSON.parse(result) as Array<{ type: string; tool_name: string }>;
    if (Array.isArray(parsed)) {
      toolNames = parsed
        .filter(item => item.type === 'tool_reference' && item.tool_name)
        .map(item => item.tool_name);
    }
  } catch {
    // Fall back to showing raw result
  }

  if (toolNames.length === 0) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  for (const name of toolNames) {
    const lineEl = container.createDiv({ cls: 'claudian-tool-search-item' });
    const iconEl = lineEl.createSpan({ cls: 'claudian-tool-search-icon' });
    setToolIcon(iconEl, name);
    lineEl.createSpan({ text: name });
  }
}

function renderWebFetchExpanded(container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line claudian-tool-line-wrap' });

  if (result.length > maxChars) {
    lineEl.setText(result.slice(0, maxChars));
    linesEl.createDiv({
      cls: 'claudian-tool-truncated',
      text: `... ${result.length - maxChars} more characters`,
    });
  } else {
    lineEl.setText(result);
  }
}

function renderApplyPatchExpanded(
  container: HTMLElement,
  input: Record<string, unknown> = {},
  result: string | undefined,
): void {
  const safeInput = input ?? {};
  const patchText = typeof safeInput.patch === 'string' ? safeInput.patch : '';
  const parsedDiffs = getApplyPatchFileDiffs(safeInput);

  if (result && /verification failed|^[Ee]rror:/.test(result.trim())) {
    renderLinesExpanded(container, result, 20);
  }

  if (parsedDiffs.length > 0) {
    renderApplyPatchDiffSections(container, parsedDiffs);
    return;
  }

  const changes = Array.isArray(safeInput.changes) ? safeInput.changes : [];
  if (changes.length > 0) {
    const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
    for (const change of changes as unknown[]) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const changeRecord = change as Record<string, unknown>;
      const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
      if (!path) continue;
      const movedTo = readMoveTarget(changeRecord.kind);
      const pathText = movedTo ? `${path} -> ${movedTo}` : path;
      linesEl.createDiv({ cls: 'claudian-tool-line', text: pathText });
    }
    return;
  }

  if (patchText) {
    renderLinesExpanded(container, patchText, 80);
    return;
  }

  if (result) {
    const fileMatches = [...result.matchAll(/(?:update|add|delete|create|modify|Applied:\s*)(?:\w+:\s*)?([^\n,]+)/gi)];
    if (fileMatches.length > 0) {
      const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
      for (const match of fileMatches) {
        const filePath = match[1]?.trim();
        if (filePath) {
          const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line' });
          lineEl.setText(filePath);
        }
      }
      return;
    }
    renderLinesExpanded(container, result, 20);
    return;
  }

  container.createDiv({ cls: 'claudian-tool-empty', text: 'Kein Ergebnis' });
}

function renderApplyPatchDiffSections(
  container: HTMLElement,
  fileDiffs: ReturnType<typeof parseApplyPatchDiffs>,
): void {
  for (const fileDiff of fileDiffs) {
    const sectionEl = container.createDiv({ cls: 'claudian-tool-patch-section' });

    if (fileDiff.operation === 'delete' && fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'claudian-tool-empty', text: 'Datei gelöscht' });
      continue;
    }

    if (fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'claudian-tool-empty', text: 'Kein Text-Diff verfügbar' });
      continue;
    }

    const diffRow = sectionEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
    const diffEl = diffRow.createDiv({ cls: 'claudian-write-edit-diff' });
    renderDiffContent(diffEl, fileDiff.diffLines);
  }
}

function readMoveTarget(kind: unknown): string | undefined {
  if (!kind || typeof kind !== 'object' || Array.isArray(kind)) {
    return undefined;
  }
  const record = kind as Record<string, unknown>;
  return typeof record.move_path === 'string' ? record.move_path : undefined;
}

function getApplyPatchFileDiffs(input: Record<string, unknown> = {}): ReturnType<typeof parseApplyPatchDiffs> {
  const safeInput = input ?? {};
  const patchText = typeof safeInput.patch === 'string' ? safeInput.patch : '';
  const parsedDiffs = patchText ? parseApplyPatchDiffs(patchText) : [];
  return parsedDiffs.length > 0 ? parsedDiffs : parseFileUpdateChangeDiffs(safeInput.changes);
}

function getApplyPatchDiffStats(input: Record<string, unknown> = {}): DiffStats | undefined {
  const safeInput = input ?? {};
  const fileDiffs = getApplyPatchFileDiffs(safeInput);
  if (fileDiffs.length === 0) return undefined;

  const stats = fileDiffs.reduce<DiffStats>(
    (acc, fileDiff) => ({
      added: acc.added + fileDiff.stats.added,
      removed: acc.removed + fileDiff.stats.removed,
    }),
    { added: 0, removed: 0 }
  );

  return stats.added > 0 || stats.removed > 0 ? stats : undefined;
}

function getDiffStatsAriaLabel(stats: DiffStats): string {
  return `Changes: +${stats.added} -${stats.removed}`;
}

function renderAgentLifecycleExpanded(container: HTMLElement, result: string): void {
  // Try to parse as JSON for structured display
  const trimmed = result.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
      for (const [key, value] of Object.entries(parsed)) {
        const lineEl = linesEl.createDiv({ cls: 'claudian-tool-line' });
        const displayValue = formatToolDisplayValue(value);
        lineEl.setText(`${key}: ${displayValue}`);
      }
      return;
    } catch { /* fall through to plain text */ }
  }
  renderLinesExpanded(container, result, 20);
}

function formatToolDisplayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

export function renderExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  input: Record<string, unknown> = {},
): void {
  const mediaActivity = resolveMediaActivity(toolName, input, result);
  if (mediaActivity && (isMediaToolName(toolName) || toolName === TOOL_READ)) {
    renderMediaContent(
      container,
      { id: '', name: toolName, input, result, status: 'completed' },
      mediaActivity,
      false,
    );
    return;
  }

  if (!result && toolName !== TOOL_WEB_SEARCH && toolName !== TOOL_BASH && toolName !== TOOL_APPLY_PATCH) {
    container.createDiv({ cls: 'claudian-tool-empty', text: 'Kein Ergebnis' });
    return;
  }

  const resolvedResult = result ?? '';

  if (isAgentLifecycleTool(toolName)) {
    renderAgentLifecycleExpanded(container, resolvedResult);
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderBashContent(container, input, resolvedResult);
      break;
    case TOOL_WRITE_STDIN:
      renderLinesExpanded(container, resolvedResult, 20);
      break;
    case TOOL_READ:
      renderFileReadExpanded(container, input, resolvedResult);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(container, resolvedResult);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(container, input, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(container, resolvedResult);
      break;
    case TOOL_TOOL_SEARCH:
      renderToolSearchExpanded(container, resolvedResult);
      break;
    case TOOL_APPLY_PATCH:
      renderApplyPatchExpanded(container, input, result);
      break;
    default:
      renderGenericToolContent(container, input, resolvedResult);
      break;
  }
}

function renderGenericToolContent(
  container: HTMLElement,
  input: Record<string, unknown> = {},
  result: string,
): void {
  const safeInput = input ?? {};
  const keys = Object.keys(safeInput).filter(k => !k.startsWith("_") && k !== "toolSummary" && k !== "toolAction" && k !== "ctx");
  if (keys.length > 0) {
    const paramsEl = container.createDiv({ cls: "claudian-tool-params-panel" });
    for (const key of keys.slice(0, 6)) {
      const val = stringifyToolValue(safeInput[key]);
      if (!val) continue;
      const paramRow = paramsEl.createDiv({ cls: "claudian-tool-param-row" });
      paramRow.createSpan({ cls: "claudian-tool-param-name", text: `${key}:` });
      paramRow.createSpan({ cls: "claudian-tool-param-val", text: truncateText(val, 120) });
    }
  }

  if (result && result.trim()) {
    const outputEl = container.createDiv({ cls: "claudian-tool-output-panel" });
    const isFileListing = /^(?:[^\n]+\/)?[\w.-]+\.\w+(?::\d+)?$/m.test(result.trim());
    if (isFileListing) {
      renderFileSearchExpanded(outputEl, result);
    } else {
      renderLinesExpanded(outputEl, result, 25);
    }
  } else {
    container.createDiv({ cls: "claudian-tool-empty", text: "Kein Ergebnis" });
  }
}

function getTodos(input: Record<string, unknown> = {}): TodoItem[] | undefined {
  const safeInput = input ?? {};
  const todos = safeInput.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

function getCurrentTask(input: Record<string, unknown> = {}): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

function areAllTodosCompleted(input: Record<string, unknown> = {}): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'claudian-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown> = {}): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = isComplete ? 'Status: completed' : 'Status: in progress';
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, `Status: ${status}`);
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

function setApplyPatchHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';
  const stats = isError ? undefined : getApplyPatchDiffStats(toolCall.input);
  if (!stats) {
    setToolStatus(statusEl, toolCall.status);
    return;
  }

  statusEl.className = 'claudian-tool-status claudian-write-edit-stats';
  statusEl.empty();
  statusEl.setAttribute('aria-label', getDiffStatsAriaLabel(stats));
  renderDiffStats(statusEl, stats);
}

function setGenericToolHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    setApplyPatchHeaderRight(statusEl, toolCall);
    return;
  }

  setToolStatus(statusEl, toolCall.status);
}

export function renderTodoWriteResult(
  container: HTMLElement,
  input: Record<string, unknown> = {},
): void {
  container.empty();
  container.addClass('claudian-todo-panel-content');
  container.addClass('claudian-todo-list-container');

  const safeInput = input ?? {};
  const todos = safeInput.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = container.createSpan({ cls: 'claudian-tool-result-item' });
    item.setText('Aufgaben aktualisiert');
    return;
  }

  renderTodoItems(container, todos);
}

export function isBlockedToolResult(content: unknown, isError?: boolean): boolean {
  const lower = extractToolResultContent(content, { fallbackIndent: 2 }).toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

export interface ToolCallRenderOptions {
  initiallyExpanded?: boolean;
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'claudian-tool-call' });
  if (toolCall.name === TOOL_BASH) {
    toolEl.addClass('claudian-tool-call-bash');
  }
  const browserActivity = resolveBrowserActivity(toolCall.name, toolCall.input);
  if (browserActivity) {
    decorateBrowserToolElement(toolEl, browserActivity);
  }
  const mediaActivity = resolveMediaActivity(toolCall.name, toolCall.input, toolCall.result);
  if (mediaActivity) {
    decorateMediaToolElement(toolEl, mediaActivity);
  }

  const header = toolEl.createDiv({ cls: 'claudian-tool-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'claudian-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name, toolCall.input);

  const nameEl = header.createSpan({ cls: 'claudian-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input));

  const summaryEl = header.createSpan({ cls: 'claudian-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));

  function extractToolFilePath(input: Record<string, unknown> = {}): string | null {
    const safeInput = input ?? {};
    const keys = ['file_path', 'filePath', 'path', 'target_file', 'targetFile', 'file', 'image_path', 'imagePath'];
    for (const k of keys) {
      const val = safeInput[k];
      if (typeof val === 'string' && val.trim() && !val.includes('*') && !val.includes('?')) {
        return val.trim();
      }
    }
    return null;
  }

  const targetPath = extractToolFilePath(toolCall.input);
  if (targetPath) {
    toolEl.addEventListener('contextmenu', (e) => {
      const app = (window as unknown as { app?: any }).app;
      if (app) {
        showFileContextMenu(app, e, targetPath);
      }
    });
  }

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  if (targetPath) {
    const app = (window as unknown as { app?: any }).app;
    if (app) {
      renderFileActionPill(header, app, targetPath);
    }
  }

  const statusEl = header.createSpan({ cls: 'claudian-tool-status' });

  const content = toolEl.createDiv({ cls: 'claudian-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}

function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const safeInput = toolCall.input ?? {};
  const questions = safeInput.questions as AskUserQuestionItem[] | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = container.createDiv({ cls: 'claudian-ask-review' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = formatAnswer(
      (q.id ? answers[q.id] : undefined) ?? answers[q.question]
    );
    const pairEl = reviewEl.createDiv({ cls: 'claudian-ask-review-pair' });
    pairEl.createDiv({ text: `${i + 1}.`, cls: 'claudian-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'claudian-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'claudian-ask-review-q-text' });
    bodyEl.createDiv({
      text: answer || 'Not answered',
      cls: answer ? 'claudian-ask-review-a-text' : 'claudian-ask-review-empty',
    });
  }

  return true;
}

function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  container.empty();

  const safeInput = toolCall.input ?? {};
  const questions = Array.isArray(safeInput.questions)
    ? safeInput.questions as AskUserQuestionItem[]
    : [];

  if (questions.length === 0) {
    contentFallback(container, initialText || toolCall.result || 'Waiting for answer...');
    return;
  }

  if (initialText || toolCall.result) {
    container.createDiv({
      cls: 'claudian-ask-review-prompt',
      text: initialText || toolCall.result || 'Waiting for answer...',
    });
  }

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
    const question = questions[questionIndex];
    const reviewEl = container.createDiv({ cls: 'claudian-ask-review' });
    const pairEl = reviewEl.createDiv({ cls: 'claudian-ask-review-pair' });
    pairEl.createDiv({ text: `${questionIndex + 1}.`, cls: 'claudian-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'claudian-ask-review-body' });
    bodyEl.createDiv({ text: question.question, cls: 'claudian-ask-review-q-text' });

    if (!Array.isArray(question.options) || question.options.length === 0) {
      bodyEl.createDiv({ cls: 'claudian-ask-review-empty', text: 'Keine Optionen erfasst' });
      continue;
    }

    const listEl = bodyEl.createDiv({ cls: 'claudian-ask-list' });
    question.options.forEach((option, optionIndex) => {
      renderAskUserQuestionOption(listEl, option, optionIndex, question.multiSelect === true);
    });
  }
}

function renderAskUserQuestionOption(
  parentEl: HTMLElement,
  option: AskUserQuestionOption,
  optionIndex: number,
  isMultiSelect: boolean,
): void {
  const itemEl = parentEl.createDiv({ cls: 'claudian-ask-item is-disabled' });

  if (isMultiSelect) {
    itemEl.createDiv({ cls: 'claudian-ask-check', text: '[ ] ' });
  } else {
    itemEl.createDiv({ cls: 'claudian-ask-item-num', text: `${optionIndex + 1}. ` });
  }

  const contentEl = itemEl.createDiv({ cls: 'claudian-ask-item-content' });
  const labelRowEl = contentEl.createDiv({ cls: 'claudian-ask-label-row' });
  labelRowEl.createDiv({ cls: 'claudian-ask-item-label', text: option.label });

  if (option.description) {
    contentEl.createDiv({ cls: 'claudian-ask-item-desc', text: option.description });
  }
}

function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'claudian-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'claudian-tool-result-text' });
  resultText.setText(text);
}

function renderBashContent(
  container: HTMLElement,
  input: Record<string, unknown> = {},
  result: string,
  initialText?: string,
): void {
  container.addClass("claudian-tool-bash-panel");
  const safeInput = input ?? {};
  const command = (safeInput.command as string) || (safeInput.CommandLine as string) || "";
  if (command) {
    const shellEl = container.createDiv({ cls: "claudian-tool-bash-shell" });
    const dotsEl = shellEl.createDiv({ cls: "claudian-tool-bash-dots" });
    dotsEl.createSpan({ cls: "claudian-bash-dot claudian-bash-dot-red" });
    dotsEl.createSpan({ cls: "claudian-bash-dot claudian-bash-dot-yellow" });
    dotsEl.createSpan({ cls: "claudian-bash-dot claudian-bash-dot-green" });
    shellEl.createSpan({ cls: "claudian-tool-bash-prompt", text: "$" });
    const cmdEl = shellEl.createDiv({ cls: "claudian-tool-bash-command" });
    cmdEl.setText(command);
    const copyBtn = shellEl.createEl("button", { cls: "claudian-bash-copy-btn" });
    copyBtn.setAttribute("type", "button");
    copyBtn.setAttribute("aria-label", "Befehl kopieren");
    copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 14.5V13H2.5A1.5 1.5 0 0 1 1 11.5v-10A1.5 1.5 0 0 1 2.5 0H4v1.5zm1 0V3h5V1.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5zm1 13a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H12V11.5a1.5 1.5 0 0 1-1.5 1.5H6v1.5zm-3.5-3a.5.5 0 0 0 .5.5H10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H2.5a.5.5 0 0 0-.5.5v10z"/></svg>`;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(command);
    });
  }
  if (initialText) {
    const runningEl = container.createDiv({ cls: "claudian-tool-bash-running" });
    const infoEl = runningEl.createDiv({ cls: "claudian-tool-bash-running-info" });
    infoEl.createSpan({ cls: "claudian-tool-bash-running-dot" });
    infoEl.createSpan({ text: initialText });

    const killBtn = runningEl.createEl("button", {
      cls: "claudian-tool-bash-kill-btn",
      attr: { type: "button", "aria-label": "Befehl abbrechen" }
    });
    killBtn.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg><span>Abbrechen</span>`;
    killBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      killBtn.disabled = true;
      killBtn.setText("Wird gestoppt…");
      container.dispatchEvent(new CustomEvent("claudian:cancel-turn", { bubbles: true }));
    });
  } else if (result && result.trim()) {
    const outputEl = container.createDiv({ cls: "claudian-tool-bash-output" });
    const outputLines = result.split(/\r?\n/);
    if (outputLines.length > 3) {
      const outHeader = outputEl.createDiv({ cls: "claudian-bash-output-header" });
      outHeader.createSpan({ cls: "claudian-bash-output-badge", text: `${outputLines.length} Zeilen Ausgabe` });

      const copyOutputBtn = outHeader.createEl("button", {
        cls: "claudian-bash-copy-btn",
        attr: { type: "button", "aria-label": "Ausgabe kopieren", title: "Ausgabe kopieren" }
      });
      copyOutputBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 14.5V13H2.5A1.5 1.5 0 0 1 1 11.5v-10A1.5 1.5 0 0 1 2.5 0H4v1.5zm1 0V3h5V1.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5zm1 13a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H12V11.5a1.5 1.5 0 0 1-1.5 1.5H6v1.5zm-3.5-3a.5.5 0 0 0 .5.5H10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H2.5a.5.5 0 0 0-.5.5v10z"/></svg><span>Kopieren</span>`;
      copyOutputBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(result);
      });
    }
    renderLinesExpanded(outputEl, result, 20);
  } else {
    const successEl = container.createDiv({ cls: "claudian-tool-bash-success" });
    const checkEl = successEl.createSpan({ cls: "claudian-tool-bash-success-icon" });
    checkEl.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"></polyline></svg>`;
    successEl.createSpan({ text: "Befehl erfolgreich ausgeführt (Keine Ausgabe)" });
  }
}

function renderFileReadExpanded(
  container: HTMLElement,
  input: Record<string, unknown> = {},
  rawResult: string,
): void {
  container.addClass("claudian-tool-read-panel");
  const safeInput = input ?? {};
  const filePath =
    (safeInput.file_path as string) ||
    (safeInput.path as string) ||
    (safeInput.target_file as string) ||
    (safeInput.absolute_path as string) ||
    (safeInput.FilePath as string) ||
    (safeInput.AbsolutePath as string) ||
    "";

  let rangeStart: number | undefined;
  let rangeEnd: number | undefined;
  let cleanFilePath = filePath;

  const rawLines = rawResult.split(/\r?\n/);
  const codeLines: Array<{ lineNum: string; text: string }> = [];

  let isHeader = true;
  for (const line of rawLines) {
    if (isHeader) {
      const pathMatch = line.match(/^File Path:\s*`?(?:file:\/\/)?([^`\n]+)`?/i);
      if (pathMatch) {
        cleanFilePath = cleanFilePath || pathMatch[1];
        continue;
      }
      const rangeMatch = line.match(/^Showing lines\s*(\d+)\s*to\s*(\d+)/i);
      if (rangeMatch) {
        rangeStart = parseInt(rangeMatch[1], 10);
        rangeEnd = parseInt(rangeMatch[2], 10);
        continue;
      }
      if (/^Total Lines:/i.test(line) || /^Total Bytes:/i.test(line) || /^The following code has been modified/i.test(line)) {
        continue;
      }
      isHeader = false;
    }

    const numMatch = line.match(/^(\d+)[:\t|]\s?(.*)$/);
    if (numMatch) {
      codeLines.push({ lineNum: numMatch[1], text: numMatch[2] });
    } else {
      const fallbackNum = rangeStart !== undefined ? String(rangeStart + codeLines.length) : "";
      codeLines.push({ lineNum: fallbackNum, text: line });
    }
  }

  const fileName = cleanFilePath.split(/[\\/]/).pop() || "Datei";

  const viewerEl = container.createDiv({ cls: "claudian-code-viewer" });
  const headerEl = viewerEl.createDiv({ cls: "claudian-code-header" });

  const titleEl = headerEl.createDiv({ cls: "claudian-code-title" });
  const iconContainer = titleEl.createSpan({ cls: "claudian-code-format-icon" });
  renderFileFormatBadge(iconContainer, fileName);
  titleEl.createSpan({ cls: "claudian-code-filename", text: fileName });

  const metaEl = headerEl.createDiv({ cls: "claudian-code-meta" });
  if (rangeStart !== undefined && rangeEnd !== undefined) {
    metaEl.createSpan({ cls: "claudian-code-range-badge", text: `Zeilen ${rangeStart}–${rangeEnd}` });
  } else if (codeLines.length > 0) {
    metaEl.createSpan({ cls: "claudian-code-range-badge", text: `${codeLines.length} Zeilen` });
  }

  const copyBtn = metaEl.createEl("button", { cls: "claudian-code-copy-btn" });
  copyBtn.setAttribute("type", "button");
  copyBtn.setAttribute("aria-label", "Code kopieren");
  copyBtn.setAttribute("title", "Code kopieren");
  copyBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 14.5V13H2.5A1.5 1.5 0 0 1 1 11.5v-10A1.5 1.5 0 0 1 2.5 0H4v1.5zm1 0V3h5V1.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5zm1 13a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H12V11.5a1.5 1.5 0 0 1-1.5 1.5H6v1.5zm-3.5-3a.5.5 0 0 0 .5.5H10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H2.5a.5.5 0 0 0-.5.5v10z"/></svg>`;
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cleanText = codeLines.map((c) => c.text).join("\n");
    void navigator.clipboard.writeText(cleanText);
  });

  const app = (window as unknown as { app?: any }).app;
  if (cleanFilePath && app) {
    const openBtn = metaEl.createEl("button", { cls: "claudian-code-open-btn" });
    openBtn.setAttribute("type", "button");
    openBtn.setAttribute("aria-label", "In Obsidian öffnen");
    openBtn.setAttribute("title", "In Obsidian öffnen");
    openBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"/><polyline points="10 2 14 2 14 6"/><line x1="7" y1="9" x2="14" y2="2"/></svg>`;
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void app.workspace.openLinkText(cleanFilePath, "", false);
    });
  }

  const bodyEl = viewerEl.createDiv({ cls: "claudian-code-body" });
  const maxDisplay = 40;
  const truncated = codeLines.length > maxDisplay;
  let isExpanded = false;

  const renderLines = () => {
    bodyEl.empty();
    const displayLines = (!isExpanded && truncated) ? codeLines.slice(0, maxDisplay) : codeLines;

    for (const line of displayLines) {
      const rowEl = bodyEl.createDiv({ cls: "claudian-code-row" });
      rowEl.createSpan({ cls: "claudian-code-gutter", text: line.lineNum || " " });
      rowEl.createSpan({ cls: "claudian-code-content claudian-tool-line", text: line.text || " " });
    }

    if (truncated) {
      const toggleEl = bodyEl.createEl("button", {
        cls: "claudian-tool-expand-btn",
        attr: { type: "button" }
      });
      toggleEl.setText(isExpanded ? "▲ Weniger Zeilen anzeigen" : `▼ + ${codeLines.length - maxDisplay} weitere Zeilen anzeigen`);
      toggleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;
        renderLines();
      });
    }
  };
  renderLines();
}

function createCurrentTaskPreview(
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = header.createSpan({ cls: 'claudian-tool-current' });
  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.setText(currentTask.activeForm);
  }
  return currentTaskEl;
}

function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.toggleClass('claudian-hidden', expanded);
    }
    if (statusEl) {
      statusEl.toggleClass('claudian-hidden', expanded);
    }
  };
}

function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  const browserActivity = resolveBrowserActivity(toolCall.name, toolCall.input);
  const mediaActivity = resolveMediaActivity(toolCall.name, toolCall.input, toolCall.result);

  if (toolCall.name === TOOL_TODO_WRITE) {
    content.addClass('claudian-tool-content-todo');
    renderTodoWriteResult(content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('claudian-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (toolCall.name === TOOL_BASH) {
    renderBashContent(content, toolCall.input, toolCall.result ?? '', initialText);
  } else if (browserActivity) {
    renderBrowserContent(
      content,
      toolCall,
      browserActivity,
      Boolean(initialText) || toolCall.status === 'running',
    );
  } else if (mediaActivity) {
    renderMediaContent(
      content,
      toolCall,
      mediaActivity,
      Boolean(initialText) || toolCall.status === 'running',
    );
  } else if (initialText) {
    contentFallback(content, initialText);
  } else {
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
  options: ToolCallRenderOptions = {}
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setGenericToolHeaderRight(statusEl, toolCall);

  renderToolContent(content, toolCall, 'Running...');

  const initiallyExpanded = options.initiallyExpanded ?? false;
  const state = { isExpanded: initiallyExpanded };
  toolCall.isExpanded = initiallyExpanded;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(content, toolCall.input);
    }
    const nameEl = toolEl.querySelector('.claudian-tool-name') as HTMLElement;
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
    }
    const currentTaskEl = toolEl.querySelector('.claudian-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.setText(currentTask ? currentTask.activeForm : '');
    }
    return;
  }

  const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
  if (statusEl) {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      content.addClass('claudian-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
  if (content) {
    const browserActivity = resolveBrowserActivity(toolCall.name, toolCall.input);
    if (browserActivity) {
      renderBrowserContent(content, toolCall, browserActivity, toolCall.status === 'running');
      return;
    }
    const mediaActivity = resolveMediaActivity(toolCall.name, toolCall.input, toolCall.result);
    if (mediaActivity) {
      renderMediaContent(content, toolCall, mediaActivity, toolCall.status === 'running');
      return;
    }
    content.empty();
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  options: ToolCallRenderOptions = {}
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: options.initiallyExpanded ?? false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

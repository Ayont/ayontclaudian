/**
 * Browser / desktop automation card.
 *
 * One card for every driver (Hermes browser_*, Claude-in-Chrome MCP, Playwright
 * / Chrome DevTools / Browser Use MCP, Hermes computer_use). Layout is a tiny
 * browser window: title bar with traffic dots + address, a viewport that shows
 * the screenshot when the result carries one and a pulsing "working" placeholder
 * while the tool runs, and a result strip for text output.
 */

import { setIcon } from 'obsidian';

import {
  type BrowserActivity,
  type BrowserActivityDriver,
  describeBrowserActivity,
  extractBrowserScreenshot,
} from '../../../core/tools/browserActivity';
import type { ToolCallInfo } from '../../../core/types';

const DRIVER_LABELS: Record<BrowserActivityDriver, string> = {
  hermes: 'Hermes Browser',
  'claude-chrome': 'Claude in Chrome',
  mcp: 'Browser (MCP)',
};

const ACTION_ICONS: Record<BrowserActivity['action'], string> = {
  navigate: 'globe',
  click: 'mouse-pointer-click',
  type: 'keyboard',
  press: 'command',
  scroll: 'move-vertical',
  back: 'arrow-left',
  snapshot: 'scan-eye',
  vision: 'eye',
  images: 'image',
  console: 'terminal-square',
  script: 'code-2',
  tab: 'app-window',
  record: 'video',
  wait: 'clock',
  other: 'mouse-pointer-2',
};

export function getBrowserDriverLabel(activity: BrowserActivity): string {
  if (activity.kind === 'desktop') {
    return activity.driver === 'hermes' ? 'Hermes Desktop' : 'Desktop (MCP)';
  }
  return DRIVER_LABELS[activity.driver];
}

export function getBrowserActionIcon(activity: BrowserActivity): string {
  if (activity.kind === 'desktop' && activity.action === 'snapshot') return 'monitor';
  if (activity.kind === 'desktop' && activity.action === 'other') return 'monitor-smartphone';
  return ACTION_ICONS[activity.action];
}

/** Marks the tool card element so CSS can style it as a browser window. */
export function decorateBrowserToolElement(toolEl: HTMLElement, activity: BrowserActivity): void {
  toolEl.addClass('claudian-tool-call-browser');
  if (activity.kind === 'desktop') toolEl.addClass('claudian-tool-call-desktop');
  toolEl.dataset.browserDriver = activity.driver;
  toolEl.dataset.browserAction = activity.action;
}

const MAX_RESULT_CHARS = 1200;

function trimResult(result: string): string {
  const compact = result.replace(/\s+$/, '');
  return compact.length > MAX_RESULT_CHARS ? `${compact.slice(0, MAX_RESULT_CHARS - 1)}…` : compact;
}

function stripScreenshot(result: string, screenshot: string | null): string {
  if (!screenshot) return result;
  return result.replace(screenshot, '').replace(/^\s*[\r\n]+/, '').trim();
}

/**
 * Renders (or re-renders) the body of a browser card. `running` shows the
 * placeholder viewport; otherwise the viewport takes the screenshot (if any)
 * and the result strip takes the remaining text.
 */
export function renderBrowserContent(
  container: HTMLElement,
  toolCall: ToolCallInfo,
  activity: BrowserActivity,
  running: boolean,
): void {
  container.empty();
  container.addClass('claudian-browser-panel');

  const { detail } = describeBrowserActivity(activity);

  // Title bar — a miniature browser chrome.
  const chrome = container.createDiv({ cls: 'claudian-browser-chrome' });
  const dots = chrome.createSpan({ cls: 'claudian-browser-dots' });
  dots.setAttribute('aria-hidden', 'true');
  dots.createSpan();
  dots.createSpan();
  dots.createSpan();
  const addressIcon = chrome.createSpan({ cls: 'claudian-browser-address-icon' });
  addressIcon.setAttribute('aria-hidden', 'true');
  setIcon(addressIcon, activity.kind === 'desktop' ? 'monitor' : 'lock');
  const addressText = activity.url ?? (activity.kind === 'desktop' ? (activity.target ?? 'Desktop') : detail || '—');
  const address = chrome.createSpan({ cls: 'claudian-browser-address', text: addressText });
  address.setAttribute('title', addressText);
  chrome.createSpan({ cls: 'claudian-browser-driver', text: getBrowserDriverLabel(activity) });

  // Action strip — what the agent is doing in that window.
  const actionRow = container.createDiv({ cls: 'claudian-browser-action' });
  const actionIcon = actionRow.createSpan({ cls: 'claudian-browser-action-icon' });
  actionIcon.setAttribute('aria-hidden', 'true');
  setIcon(actionIcon, getBrowserActionIcon(activity));
  actionRow.createSpan({ cls: 'claudian-browser-action-title', text: describeBrowserActivity(activity).title });
  if (detail) {
    actionRow.createSpan({ cls: 'claudian-browser-action-detail', text: detail });
  }

  // Viewport.
  const viewport = container.createDiv({ cls: 'claudian-browser-viewport' });
  const screenshot = running ? null : extractBrowserScreenshot(toolCall.result);
  if (running) {
    viewport.addClass('is-running');
    viewport.setAttribute('role', 'status');
    viewport.setAttribute('aria-live', 'polite');
    const pulse = viewport.createDiv({ cls: 'claudian-browser-pulse' });
    pulse.createSpan({ cls: 'claudian-browser-pulse-ring' });
    pulse.createSpan({ cls: 'claudian-browser-pulse-core' });
    viewport.createDiv({
      cls: 'claudian-browser-viewport-label',
      text: activity.kind === 'desktop' ? 'Desktop wird gesteuert…' : 'Browser arbeitet…',
    });
  } else if (screenshot) {
    viewport.addClass('has-shot');
    const img = viewport.createEl('img', { cls: 'claudian-browser-shot' });
    img.setAttribute('src', screenshot.startsWith('data:') ? screenshot : `app://local/${screenshot.replace(/^\//, '')}`);
    img.setAttribute('alt', `Screenshot: ${detail || activity.url || 'Browser'}`);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  } else {
    viewport.addClass('is-empty');
    const glyph = viewport.createSpan({ cls: 'claudian-browser-viewport-glyph' });
    glyph.setAttribute('aria-hidden', 'true');
    setIcon(glyph, toolCall.status === 'error' ? 'alert-triangle' : getBrowserActionIcon(activity));
  }

  // Result strip.
  if (!running) {
    const text = stripScreenshot(toolCall.result ?? '', screenshot);
    if (text) {
      const result = container.createDiv({ cls: 'claudian-browser-result' });
      result.toggleClass('is-error', toolCall.status === 'error' || toolCall.status === 'blocked');
      result.setText(trimResult(text));
    } else if (!screenshot) {
      container.createDiv({ cls: 'claudian-tool-empty', text: 'Kein Ergebnis' });
    }
  }
}

import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import { TOOL_TASK } from '../../../core/tools/toolNames';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import {
  describeSubagentActivity,
  formatSubagentDuration,
  formatSubagentTokens,
  isLiveSubagentPhase,
  resolveSubagentPhase,
  SUBAGENT_PHASE_LABELS,
  type SubagentPhase,
  subagentTitle,
  summarizeSubagent,
} from '../subagents/subagentPresentation';
import { setupCollapsible } from './collapsible';
import {
  getToolLabel,
  getToolName,
  getToolSummary,
  renderExpandedContent,
  setToolIcon,
} from './ToolCallRenderer';

/**
 * Inline subagent card. One component for every origin (foreground and
 * background agents, workflows, provider lifecycle agents, stored history):
 * the lifecycle functions only change `info`, and `refreshSubagentCard`
 * redraws the card from it in place.
 *
 * The header is the disclosure control; the card actions sit beside it, not
 * inside it, so no button is nested in another. Actions carry
 * `data-subagent-action` and are handled by delegation at the chat level.
 */

interface SubagentToolView {
  wrapperEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
  renderedKey: string;
}

export interface SubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  statusEl: HTMLElement;
  /** Phase label beside the elapsed time ("Läuft", "Gestoppt", …). */
  statusTextEl: HTMLElement;
  promptSectionEl: HTMLElement;
  promptBodyEl: HTMLElement;
  toolsContainerEl: HTMLElement;
  resultSectionEl: HTMLElement | null;
  resultBodyEl: HTMLElement | null;
  toolElements: Map<string, SubagentToolView>;
  info: SubagentInfo;
  parts: SubagentCardParts;
}

/** Background agents share the card; the alias keeps the lifecycle API readable. */
export type AsyncSubagentState = SubagentState;

interface SubagentCardParts {
  typeEl: HTMLElement;
  activityEl: HTMLElement;
  activityIconEl: HTMLElement;
  activityTextEl: HTMLElement;
  elapsedEl: HTMLElement;
  stopBtn: HTMLButtonElement;
  trailEl: HTMLElement;
  factsEl: HTMLElement;
  renderedPhase: SubagentPhase | null;
  renderedActivity: string;
  renderedPrompt: string | null;
  renderedResult: string | null;
  /** Live cards animate their state changes; restored history stays still. */
  animate: boolean;
}

const SUBAGENT_TOOL_STATUS_ICONS: Partial<Record<ToolCallInfo['status'], string>> = {
  running: 'loader-2',
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

const TOOL_STATUS_LABELS: Partial<Record<ToolCallInfo['status'], string>> = {
  running: 'läuft',
  completed: 'fertig',
  error: 'Fehler',
  blocked: 'blockiert',
};

const PHASE_GLYPH_ICONS: Partial<Record<SubagentPhase, string>> = {
  completed: 'check',
  failed: 'x',
  cancelled: 'square',
  orphaned: 'alert-circle',
};

/** Glyph classes kept stable for themes and tests that key on them. */
const PHASE_STATUS_CLASS: Record<SubagentPhase, string> = {
  starting: 'status-running',
  running: 'status-running',
  stopping: 'status-stopping',
  completed: 'status-completed',
  failed: 'status-error',
  cancelled: 'status-cancelled',
  orphaned: 'status-error',
};

const ORPHANED_RESULT = 'Der Chat endete, bevor der Subagent fertig war.';
const TRAIL_MAX_STEPS = 48;

// ─── Live clock ─────────────────────────────────────────────────────────────
// One ticker for every running card in the window; it stops when none is left.

const liveClockEls = new Map<HTMLElement, number>();
let liveClockTimer: number | null = null;

function tickLiveClocks(): void {
  const now = Date.now();
  for (const [el, since] of liveClockEls) {
    if (!el.isConnected) {
      liveClockEls.delete(el);
      continue;
    }
    el.setText(formatSubagentDuration(now - since));
  }
  if (liveClockEls.size === 0 && liveClockTimer !== null) {
    window.clearInterval(liveClockTimer);
    liveClockTimer = null;
  }
}

function setLiveClock(el: HTMLElement, since: number | null): void {
  if (since === null) {
    liveClockEls.delete(el);
    el.removeAttribute('data-live-since');
    return;
  }
  el.setAttribute('data-live-since', String(since));
  // Detached elements (and test doubles) never tick; the text is set anyway.
  if (!el.isConnected) return;
  liveClockEls.set(el, since);
  if (liveClockTimer === null) {
    liveClockTimer = window.setInterval(tickLiveClocks, 1000);
  }
}

// ─── Card construction ──────────────────────────────────────────────────────

function createSection(parentEl: HTMLElement, title: string, bodyClass: string): { wrapperEl: HTMLElement; bodyEl: HTMLElement } {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-section' });
  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-section-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.createDiv({ cls: 'claudian-subagent-section-title', text: title });

  const bodyEl = wrapperEl.createDiv({ cls: 'claudian-subagent-section-body' });
  bodyEl.addClass(bodyClass);
  setupCollapsible(wrapperEl, headerEl, bodyEl, { isExpanded: false }, { baseAriaLabel: title });
  return { wrapperEl, bodyEl };
}

function createActionButton(parentEl: HTMLElement, action: string, icon: string, label: string): HTMLButtonElement {
  const button = parentEl.createEl('button', {
    cls: `claudian-subagent-action claudian-subagent-action--${action}`,
    attr: { type: 'button', 'data-subagent-action': action, 'aria-label': label, title: label },
  }) as HTMLButtonElement;
  const iconEl = button.createSpan({ cls: 'claudian-subagent-action-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, icon);
  button.createSpan({ cls: 'claudian-subagent-action-label' });
  return button;
}

function buildCard(parentEl: HTMLElement, info: SubagentInfo, animate: boolean): SubagentState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-subagent-list claudian-subagent-card' });
  wrapperEl.setAttribute('data-subagent-card-id', info.id);
  if (info.mode === 'async') {
    wrapperEl.dataset.asyncSubagentId = info.id;
  } else {
    wrapperEl.dataset.subagentId = info.id;
  }
  if (animate) wrapperEl.addClass('is-live');

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const statusEl = headerEl.createDiv({ cls: 'claudian-subagent-status' });
  statusEl.setAttribute('aria-hidden', 'true');

  const headingEl = headerEl.createDiv({ cls: 'claudian-subagent-heading' });
  const titleRowEl = headingEl.createDiv({ cls: 'claudian-subagent-title-row' });
  const kindIconEl = titleRowEl.createSpan({ cls: 'claudian-subagent-icon' });
  kindIconEl.setAttribute('aria-hidden', 'true');
  setIcon(kindIconEl, info.kind === 'workflow' ? 'workflow' : getToolIcon(TOOL_TASK));
  const labelEl = titleRowEl.createSpan({ cls: 'claudian-subagent-label' });
  const typeEl = titleRowEl.createSpan({ cls: 'claudian-subagent-type' });

  const activityEl = headingEl.createDiv({ cls: 'claudian-subagent-activity' });
  const activityIconEl = activityEl.createSpan({ cls: 'claudian-subagent-activity-icon' });
  activityIconEl.setAttribute('aria-hidden', 'true');
  const activityTextEl = activityEl.createSpan({ cls: 'claudian-subagent-activity-text' });

  const sideEl = headerEl.createDiv({ cls: 'claudian-subagent-side' });
  const statusTextEl = sideEl.createSpan({ cls: 'claudian-subagent-status-text' });
  const elapsedEl = sideEl.createSpan({ cls: 'claudian-subagent-elapsed' });

  const actionsEl = wrapperEl.createDiv({ cls: 'claudian-subagent-actions' });
  createActionButton(actionsEl, 'inspect', 'panel-right-open', 'Im Inspektor-Tab öffnen');
  const stopBtn = createActionButton(actionsEl, 'stop', 'square', 'Subagent stoppen');

  const trailEl = wrapperEl.createDiv({ cls: 'claudian-subagent-trail' });
  trailEl.setAttribute('aria-hidden', 'true');

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-content' });
  const factsEl = contentEl.createDiv({ cls: 'claudian-subagent-facts' });
  const promptSection = createSection(contentEl, 'Auftrag', 'claudian-subagent-prompt-body');
  promptSection.wrapperEl.addClass('claudian-subagent-section-prompt');
  const toolsContainerEl = contentEl.createDiv({ cls: 'claudian-subagent-tools' });

  setupCollapsible(wrapperEl, headerEl, contentEl, info, {
    initiallyExpanded: info.isExpanded,
  });

  const state: SubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    statusEl,
    statusTextEl,
    promptSectionEl: promptSection.wrapperEl,
    promptBodyEl: promptSection.bodyEl,
    toolsContainerEl,
    resultSectionEl: null,
    resultBodyEl: null,
    toolElements: new Map(),
    info,
    parts: {
      typeEl,
      activityEl,
      activityIconEl,
      activityTextEl,
      elapsedEl,
      stopBtn,
      trailEl,
      factsEl,
      renderedPhase: null,
      renderedActivity: '',
      renderedPrompt: null,
      renderedResult: null,
      animate,
    },
  };
  refreshSubagentCard(state);
  return state;
}

// ─── Refresh ────────────────────────────────────────────────────────────────

/** Redraws the card from `state.info`; cheap enough to call on every event. */
export function refreshSubagentCard(state: SubagentState): void {
  const { info, parts } = state;
  const resolved = resolveSubagentPhase(info);
  // A restored foreground card that still reads as running ended with its
  // chat; background agents keep their stored state.
  const phase = !parts.animate && isLiveSubagentPhase(resolved) && info.mode !== 'async' ? 'orphaned' : resolved;
  const live = isLiveSubagentPhase(phase);
  const phaseLabel = phaseText(info, phase);

  state.wrapperEl.setAttribute('data-phase', phase);
  applyLegacyClasses(state, phase);

  const title = subagentTitle(info);
  state.labelEl.setText(title);
  state.labelEl.setAttribute('title', title);
  parts.typeEl.setText(info.agentType ?? '');
  parts.typeEl.toggleClass('claudian-hidden', !info.agentType);

  renderActivity(state, phase);
  renderGlyph(state, phase);
  state.statusTextEl.setText(phaseLabel);
  renderElapsed(state, live);
  renderStopButton(state, live);
  renderTrail(state);
  renderFacts(state);
  renderPrompt(state);
  renderTools(state);
  renderResult(state, phase);

  state.headerEl.setAttribute('aria-label', `Subagent: ${title} – ${phaseLabel}`);
  parts.renderedPhase = phase;
}

function phaseText(info: SubagentInfo, phase: SubagentPhase): string {
  if (phase === 'running' && info.mode === 'async' && info.kind !== 'workflow') return 'Läuft im Hintergrund';
  return SUBAGENT_PHASE_LABELS[phase];
}

function applyLegacyClasses(state: SubagentState, phase: SubagentPhase): void {
  const el = state.wrapperEl;
  if (state.info.mode === 'async') applyAsyncClasses(state, phase);
  el.toggleClass('done', phase === 'completed');
  el.toggleClass('error', phase === 'failed' || phase === 'orphaned' || (state.info.mode === 'async' && phase === 'cancelled'));
  el.toggleClass('cancelled', phase === 'cancelled');
}

function applyAsyncClasses(state: SubagentState, phase: SubagentPhase): void {
  const el = state.wrapperEl;
  for (const cls of ['pending', 'running', 'awaiting', 'completed', 'error', 'orphaned']) {
    el.removeClass(cls);
  }
  el.addClass('async');
  // A launch restored from history never got its agent id; it reads as running.
  const asyncClass = phase === 'starting' && state.parts.animate ? 'pending'
    : phase === 'orphaned' ? 'orphaned'
      : phase === 'completed' ? 'completed'
        : phase === 'failed' || phase === 'cancelled' ? 'error'
          : 'running';
  el.addClass(asyncClass);
}

function renderGlyph(state: SubagentState, phase: SubagentPhase): void {
  if (state.parts.renderedPhase === phase) return;
  const glyph = state.statusEl;
  glyph.className = `claudian-subagent-status ${PHASE_STATUS_CLASS[phase]}`;
  glyph.empty();
  const icon = PHASE_GLYPH_ICONS[phase];
  if (icon) {
    setIcon(glyph, icon);
  } else {
    // Live phases draw a CSS ring; transform-only, paused under reduced motion.
    glyph.createSpan({ cls: 'claudian-subagent-ring' });
  }
  // A settle pulse marks the moment a live card reaches its outcome.
  if (state.parts.animate && state.parts.renderedPhase && icon) {
    glyph.addClass('is-settling');
  }
}

function renderActivity(state: SubagentState, phase: SubagentPhase): void {
  const { parts, info } = state;
  const activity = describeSubagentActivity(info);
  const text = activity?.text ?? (isLiveSubagentPhase(phase) ? 'Wird vorbereitet …' : '');
  parts.activityEl.toggleClass('claudian-hidden', !text);
  parts.activityEl.toggleClass('is-outcome', !isLiveSubagentPhase(phase));
  if (text === parts.renderedActivity) return;

  parts.activityIconEl.empty();
  if (activity?.toolName) {
    setToolIcon(parts.activityIconEl, activity.toolName);
  } else {
    setIcon(parts.activityIconEl, isLiveSubagentPhase(phase) ? 'sparkles' : 'corner-down-right');
  }
  parts.activityTextEl.setText(text);
  parts.activityTextEl.setAttribute('title', text);
  if (parts.animate && parts.renderedActivity) {
    // Restart the enter animation for the new line.
    parts.activityTextEl.removeClass('is-changing');
    void parts.activityTextEl.offsetWidth;
    parts.activityTextEl.addClass('is-changing');
  }
  parts.renderedActivity = text;
}

/**
 * Only cards created by this stream tick and offer Stop: a card restored from
 * history that was saved mid-run has no process behind it any more.
 */
function isAttachedToLiveRun(state: SubagentState, live: boolean): boolean {
  return live && state.parts.animate;
}

function renderElapsed(state: SubagentState, live: boolean): void {
  const { elapsedEl } = state.parts;
  const ticking = isAttachedToLiveRun(state, live);
  const summary = summarizeSubagent(state.info);
  const elapsed = ticking || !live ? summary.elapsedMs : undefined;
  elapsedEl.setText(elapsed !== undefined ? formatSubagentDuration(elapsed) : '');
  setLiveClock(elapsedEl, ticking && state.info.startedAt !== undefined ? state.info.startedAt : null);
}

function renderStopButton(state: SubagentState, live: boolean): void {
  const { stopBtn } = state.parts;
  const stopping = state.info.cancelState === 'requested';
  stopBtn.toggleClass('claudian-hidden', !isAttachedToLiveRun(state, live));
  stopBtn.disabled = stopping;
  if (stopping) stopBtn.removeClass('is-armed');
}

function trailStatus(call: ToolCallInfo): string {
  return call.status === 'blocked' ? 'error' : call.status;
}

/**
 * One step per tool call, in order. Past the step budget, steps stand for
 * buckets of calls and show the worst outcome inside them.
 */
function renderTrail(state: SubagentState): void {
  const calls = state.info.toolCalls;
  const { trailEl } = state.parts;
  trailEl.toggleClass('claudian-hidden', calls.length === 0);
  if (calls.length === 0) {
    trailEl.empty();
    return;
  }

  const bucketSize = Math.ceil(calls.length / TRAIL_MAX_STEPS);
  const statuses: string[] = [];
  for (let i = 0; i < calls.length; i += bucketSize) {
    const bucket = calls.slice(i, i + bucketSize).map(trailStatus);
    statuses.push(bucket.includes('error') ? 'error' : bucket.includes('running') ? 'running' : 'completed');
  }

  // Steps are only appended while the bucket size holds, so each new tool pops
  // in once instead of the whole trail re-animating.
  if (trailEl.getAttribute('data-bucket') !== String(bucketSize)) {
    trailEl.empty();
    trailEl.setAttribute('data-bucket', String(bucketSize));
  }
  const existing = Array.from(trailEl.children) as HTMLElement[];
  statuses.forEach((status, index) => {
    const step = existing[index] ?? trailEl.createSpan({ cls: 'claudian-subagent-trail-step' });
    if (step.getAttribute('data-status') !== status) step.setAttribute('data-status', status);
  });
  for (const extra of existing.slice(statuses.length)) extra.remove();
}

function renderFacts(state: SubagentState): void {
  const { info, parts } = state;
  const summary = summarizeSubagent(info);
  const facts: Array<[string, string]> = [];
  if (info.agentType) facts.push(['Typ', info.agentType]);
  if (info.model) facts.push(['Modell', info.model]);
  facts.push(['Modus', info.kind === 'workflow' ? 'Workflow' : info.mode === 'async' ? 'Hintergrund' : 'Vordergrund']);
  if (summary.toolCount > 0) facts.push(['Werkzeuge', String(summary.toolCount)]);
  if (summary.failedTools > 0) facts.push(['Fehler', String(summary.failedTools)]);
  if (summary.totalTokens) facts.push(['Tokens', formatSubagentTokens(summary.totalTokens).replace(' Tokens', '')]);

  const key = facts.map(([k, v]) => `${k}=${v}`).join('|');
  if (parts.factsEl.getAttribute('data-key') === key) return;
  parts.factsEl.setAttribute('data-key', key);
  parts.factsEl.empty();
  for (const [label, value] of facts) {
    const fact = parts.factsEl.createSpan({ cls: 'claudian-subagent-fact' });
    fact.createSpan({ cls: 'claudian-subagent-fact-label', text: label });
    fact.createSpan({ cls: 'claudian-subagent-fact-value', text: value });
  }
}

function renderPrompt(state: SubagentState): void {
  const prompt = state.info.prompt ?? '';
  if (state.parts.renderedPrompt === prompt) return;
  state.parts.renderedPrompt = prompt;
  state.promptBodyEl.empty();
  state.promptBodyEl.createDiv({
    cls: 'claudian-subagent-prompt-text',
    text: prompt || 'Kein Auftrag übermittelt',
  });
}

function renderTools(state: SubagentState): void {
  for (const toolCall of state.info.toolCalls) {
    if (!toolCall) continue;
    const view = state.toolElements.get(toolCall.id);
    if (view) {
      updateSubagentToolView(view, toolCall);
    } else {
      state.toolElements.set(toolCall.id, createSubagentToolView(state.toolsContainerEl, toolCall));
    }
  }
}

function resultText(info: SubagentInfo, phase: SubagentPhase): string | null {
  const result = info.result?.trim() ? info.result : '';
  switch (phase) {
    case 'completed': return result || 'Fertig.';
    case 'failed': return result || 'Fehlgeschlagen.';
    case 'orphaned': return result || ORPHANED_RESULT;
    // The provider's own result for a stop is its interrupt notice.
    case 'cancelled': return 'Von dir gestoppt.';
    default: return null;
  }
}

function renderResult(state: SubagentState, phase: SubagentPhase): void {
  const text = resultText(state.info, phase);
  if (text === state.parts.renderedResult) return;
  state.parts.renderedResult = text;
  if (text === null) {
    state.resultSectionEl?.remove();
    state.resultSectionEl = null;
    state.resultBodyEl = null;
    return;
  }
  if (!state.resultSectionEl || !state.resultBodyEl) {
    const section = createSection(state.contentEl, 'Ergebnis', 'claudian-subagent-result-body');
    section.wrapperEl.addClass('claudian-subagent-section-result');
    state.resultSectionEl = section.wrapperEl;
    state.resultBodyEl = section.bodyEl;
  }
  state.resultBodyEl.empty();
  state.resultBodyEl.createDiv({ cls: 'claudian-subagent-result-output', text });
}

// ─── Child tool rows ────────────────────────────────────────────────────────

// Serializing a tool's input on every redraw grew with each child call (large
// Write inputs); inputs are replaced, not mutated, so their size is cached.
const inputSizes = new WeakMap<object, number>();

function inputSize(input: Record<string, unknown> | undefined): number {
  if (!input) return 0;
  let size = inputSizes.get(input);
  if (size === undefined) {
    size = JSON.stringify(input).length;
    inputSizes.set(input, size);
  }
  return size;
}

function toolRenderKey(toolCall: ToolCallInfo): string {
  return `${toolCall.status}:${toolCall.result?.length ?? -1}:${inputSize(toolCall.input)}`;
}

function renderSubagentToolContent(contentEl: HTMLElement, toolCall: ToolCallInfo): void {
  contentEl.empty();
  if (!toolCall.result && toolCall.status === 'running') {
    contentEl.createDiv({ cls: 'claudian-subagent-tool-empty', text: 'Läuft …' });
    return;
  }
  renderExpandedContent(contentEl, toolCall.name, toolCall.result, toolCall.input);
}

function setSubagentToolStatus(view: SubagentToolView, status: ToolCallInfo['status']): void {
  view.statusEl.className = 'claudian-subagent-tool-status';
  view.statusEl.addClass(`status-${status}`);
  view.statusEl.empty();
  view.statusEl.setAttribute('aria-label', `Status: ${TOOL_STATUS_LABELS[status] ?? status}`);
  const statusIcon = SUBAGENT_TOOL_STATUS_ICONS[status];
  if (statusIcon) setIcon(view.statusEl, statusIcon);
}

function updateSubagentToolView(view: SubagentToolView, toolCall: ToolCallInfo): void {
  const key = toolRenderKey(toolCall);
  if (view.renderedKey === key) return;
  view.renderedKey = key;
  const status = toolCall.status || 'running';
  const safeInput = toolCall.input ?? {};
  view.wrapperEl.className = `claudian-subagent-tool-item claudian-subagent-tool-${status}`;
  view.nameEl.setText(getToolName(toolCall.name, safeInput));
  view.summaryEl.setText(getToolSummary(toolCall.name, safeInput));
  setSubagentToolStatus(view, status);
  renderSubagentToolContent(view.contentEl, toolCall);
}

function createSubagentToolView(parentEl: HTMLElement, toolCall: ToolCallInfo): SubagentToolView {
  const status = toolCall.status || 'running';
  const safeInput = toolCall.input ?? {};
  const wrapperEl = parentEl.createDiv({ cls: `claudian-subagent-tool-item claudian-subagent-tool-${status}` });
  wrapperEl.dataset.toolId = toolCall.id;

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-subagent-tool-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name, safeInput);

  const nameEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-name' });
  const summaryEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-summary' });
  const statusEl = headerEl.createDiv({ cls: 'claudian-subagent-tool-status' });
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-subagent-tool-content' });

  setupCollapsible(wrapperEl, headerEl, contentEl, { isExpanded: toolCall.isExpanded ?? false }, {
    initiallyExpanded: toolCall.isExpanded ?? false,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, safeInput),
  });

  const view: SubagentToolView = { wrapperEl, nameEl, summaryEl, statusEl, contentEl, renderedKey: '' };
  updateSubagentToolView(view, toolCall);
  return view;
}

// ─── Lifecycle API ──────────────────────────────────────────────────────────

function copyToolCalls(subagent: SubagentInfo): ToolCallInfo[] {
  return (Array.isArray(subagent.toolCalls) ? subagent.toolCalls : [])
    .filter(Boolean)
    .map(call => ({ ...call, input: call.input ? { ...call.input } : {} }));
}

function inputString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

export function createSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown> = {}
): SubagentState {
  const safeInput = taskInput ?? {};
  const info: SubagentInfo = {
    id: taskToolId,
    description: inputString(safeInput, 'description') || 'Subagent',
    prompt: inputString(safeInput, 'prompt'),
    ...(inputString(safeInput, 'subagent_type') ? { agentType: inputString(safeInput, 'subagent_type') } : {}),
    status: 'running',
    toolCalls: [],
    isExpanded: false,
  };
  return buildCard(parentEl, info, true);
}

/** Updates what a spawning tool call revealed about the task after it started. */
export function setSubagentTask(state: SubagentState, task: { description?: string; prompt?: string }): void {
  if (task.description) state.info.description = task.description;
  if (task.prompt) state.info.prompt = task.prompt;
  refreshSubagentCard(state);
}

export function addSubagentToolCall(state: SubagentState, toolCall: ToolCallInfo): void {
  const existingIndex = state.info.toolCalls.findIndex(tc => tc.id === toolCall.id);
  if (existingIndex >= 0) {
    const existing = state.info.toolCalls[existingIndex];
    state.info.toolCalls[existingIndex] = {
      ...existing,
      ...toolCall,
      input: { ...(existing.input ?? {}), ...(toolCall.input ?? {}) },
      result: toolCall.result ?? existing.result,
      isExpanded: toolCall.isExpanded ?? existing.isExpanded,
    };
  } else {
    state.info.toolCalls.push(toolCall);
  }
  refreshSubagentCard(state);
}

export function updateSubagentToolResult(state: SubagentState, toolId: string, toolCall: ToolCallInfo): void {
  const idx = state.info.toolCalls.findIndex(tc => tc.id === toolId);
  if (idx === -1) return;
  state.info.toolCalls[idx] = toolCall;
  refreshSubagentCard(state);
}

export function finalizeSubagentBlock(state: SubagentState, result: string, isError: boolean): void {
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;
  refreshSubagentCard(state);
}

export function renderStoredSubagent(parentEl: HTMLElement, subagent: SubagentInfo): HTMLElement {
  const info: SubagentInfo = { ...subagent, toolCalls: copyToolCalls(subagent), isExpanded: false };
  return buildCard(parentEl, info, false).wrapperEl;
}

export function createAsyncSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown> = {}
): AsyncSubagentState {
  const safeInput = taskInput ?? {};
  const info: SubagentInfo = {
    id: taskToolId,
    description: inputString(safeInput, 'description') || 'Hintergrund-Subagent',
    prompt: inputString(safeInput, 'prompt'),
    ...(inputString(safeInput, 'subagent_type') ? { agentType: inputString(safeInput, 'subagent_type') } : {}),
    mode: 'async',
    status: 'running',
    toolCalls: [],
    isExpanded: false,
    asyncStatus: 'pending',
  };
  return buildCard(parentEl, info, true);
}

export function updateAsyncSubagentRunning(state: AsyncSubagentState, agentId: string): void {
  state.info.asyncStatus = 'running';
  state.info.agentId = agentId;
  refreshSubagentCard(state);
}

export function finalizeAsyncSubagent(state: AsyncSubagentState, result: string, isError: boolean): void {
  state.info.asyncStatus = isError ? 'error' : 'completed';
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;
  refreshSubagentCard(state);
}

export function markAsyncSubagentOrphaned(state: AsyncSubagentState): void {
  state.info.asyncStatus = 'orphaned';
  state.info.status = 'error';
  state.info.result = ORPHANED_RESULT;
  refreshSubagentCard(state);
}

export function renderStoredAsyncSubagent(parentEl: HTMLElement, subagent: SubagentInfo): HTMLElement {
  const info: SubagentInfo = { ...subagent, mode: 'async', toolCalls: copyToolCalls(subagent), isExpanded: false };
  return buildCard(parentEl, info, false).wrapperEl;
}

export { ORPHANED_RESULT as SUBAGENT_ORPHANED_RESULT };

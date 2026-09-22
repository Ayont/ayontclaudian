import { setIcon } from 'obsidian';

import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import {
  getToolName,
  getToolSummary,
  renderExpandedContent,
  setToolIcon,
} from '../rendering/ToolCallRenderer';
import { STOP_ARM_MS, stopConfirmLabel, type SubagentStopScope } from './SubagentActionController';
import {
  buildSubagentTranscript,
  describeSubagentActivity,
  formatSubagentDuration,
  formatSubagentTokens,
  isLiveSubagentPhase,
  resolveSubagentPhase,
  SUBAGENT_PHASE_LABELS,
  type SubagentPhase,
  subagentTitle,
  type SubagentTranscriptEntry,
  summarizeSubagent,
} from './subagentPresentation';

export interface InspectorContext {
  /** Attached to the chat tab that runs the agent (not restored from history). */
  live: boolean;
  stopScope: SubagentStopScope;
  providerLabel?: string;
  conversationTitle?: string;
}

export interface InspectorCallbacks {
  onStop: () => void;
  onLocate?: () => void;
  onOpenFile?: (path: string) => void;
  renderMarkdown: (markdown: string, el: HTMLElement) => void;
}

interface RenderedEntry {
  el: HTMLElement;
  signature: string;
}

const PHASE_GLYPH_ICONS: Partial<Record<SubagentPhase, string>> = {
  completed: 'check',
  failed: 'x',
  cancelled: 'square',
  orphaned: 'alert-circle',
};

const RESULT_TITLES: Partial<Record<SubagentPhase, string>> = {
  completed: 'Ergebnis',
  failed: 'Fehler',
  cancelled: 'Gestoppt',
  orphaned: 'Abgebrochen',
};

/** How far from the bottom still counts as following the live output. */
const FOLLOW_THRESHOLD_PX = 96;

function toolSignature(tool: ToolCallInfo): string {
  return `${tool.status}:${tool.result?.length ?? -1}:${JSON.stringify(tool.input ?? {}).length}`;
}

function entrySignature(entry: SubagentTranscriptEntry): string {
  switch (entry.kind) {
    case 'tool': return toolSignature(entry.tool);
    case 'result': return `${entry.phase}:${entry.text}`;
    default: return entry.text;
  }
}

function modeLabel(info: SubagentInfo): string {
  if (info.kind === 'workflow') return 'Workflow';
  return info.mode === 'async' ? 'Hintergrund' : 'Vordergrund';
}

/**
 * The inspector tab's content: one subagent, live. Draws incrementally so a
 * streaming agent does not rebuild the page on every event, and only entries
 * that arrive while watching animate in.
 */
export class SubagentInspectorPanel {
  private readonly heroEl: HTMLElement;
  private readonly glyphEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly provenanceEl: HTMLElement;
  private readonly contextEl: HTMLElement;
  private readonly contextTextEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly phaseTextEl: HTMLElement;
  private readonly elapsedEl: HTMLElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly stopLabelEl: HTMLElement;
  private readonly locateBtn: HTMLButtonElement;
  private readonly activityEl: HTMLElement;
  private readonly activityIconEl: HTMLElement;
  private readonly activityTextEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly liveTailEl: HTMLElement;
  private readonly filesEl: HTMLElement;
  private readonly filesSectionEl: HTMLElement;
  private readonly trailEl: HTMLElement;
  private readonly followInput: HTMLInputElement;
  private readonly emptyEl: HTMLElement;

  private readonly entries = new Map<string, RenderedEntry>();
  private info: SubagentInfo | undefined;
  private context: InspectorContext = { live: false, stopScope: 'none' };
  private renderedGlyphPhase: SubagentPhase | null = null;
  private hasRendered = false;
  private following = true;
  private armTimer: number | null = null;
  private selfScrolling = false;
  private readonly onScroll = (): void => {
    if (this.selfScrolling) return;
    const distance = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight;
    const following = distance <= FOLLOW_THRESHOLD_PX;
    if (following !== this.following) this.setFollowing(following);
  };

  constructor(private readonly root: HTMLElement, private readonly callbacks: InspectorCallbacks) {
    root.addClass('claudian-inspector');
    root.addEventListener('scroll', this.onScroll);

    this.heroEl = root.createEl('header', { cls: 'claudian-inspector-hero' });
    this.glyphEl = this.heroEl.createDiv({ cls: 'claudian-inspector-glyph' });
    this.glyphEl.setAttribute('aria-hidden', 'true');
    const headingEl = this.heroEl.createDiv({ cls: 'claudian-inspector-heading' });
    this.titleEl = headingEl.createEl('h1', { cls: 'claudian-inspector-title' });
    this.provenanceEl = headingEl.createDiv({ cls: 'claudian-inspector-provenance' });
    this.contextEl = headingEl.createDiv({ cls: 'claudian-inspector-context claudian-hidden' });
    const contextIcon = this.contextEl.createSpan({ cls: 'claudian-inspector-context-icon' });
    contextIcon.setAttribute('aria-hidden', 'true');
    setIcon(contextIcon, 'message-square');
    this.contextTextEl = this.contextEl.createSpan({ cls: 'claudian-inspector-context-text' });

    const sideEl = this.heroEl.createDiv({ cls: 'claudian-inspector-side' });
    this.phaseEl = sideEl.createSpan({ cls: 'claudian-inspector-phase' });
    this.phaseEl.createSpan({ cls: 'claudian-inspector-phase-dot' }).setAttribute('aria-hidden', 'true');
    this.phaseTextEl = this.phaseEl.createSpan({ cls: 'claudian-inspector-phase-text' });
    this.elapsedEl = sideEl.createSpan({ cls: 'claudian-inspector-elapsed' });

    const actionsEl = this.heroEl.createDiv({ cls: 'claudian-inspector-actions' });
    this.stopBtn = actionsEl.createEl('button', {
      cls: 'claudian-inspector-button claudian-inspector-stop',
      attr: { type: 'button' },
    }) as HTMLButtonElement;
    const stopIcon = this.stopBtn.createSpan({ cls: 'claudian-inspector-button-icon' });
    stopIcon.setAttribute('aria-hidden', 'true');
    setIcon(stopIcon, 'square');
    this.stopLabelEl = this.stopBtn.createSpan({ cls: 'claudian-inspector-button-label', text: 'Stoppen' });
    this.stopBtn.addEventListener('click', () => this.handleStopClick());

    this.locateBtn = actionsEl.createEl('button', {
      cls: 'claudian-inspector-button claudian-inspector-locate',
      attr: { type: 'button' },
    }) as HTMLButtonElement;
    const locateIcon = this.locateBtn.createSpan({ cls: 'claudian-inspector-button-icon' });
    locateIcon.setAttribute('aria-hidden', 'true');
    setIcon(locateIcon, 'message-square-text');
    this.locateBtn.createSpan({ cls: 'claudian-inspector-button-label', text: 'Im Chat zeigen' });
    this.locateBtn.addEventListener('click', () => this.callbacks.onLocate?.());

    this.activityEl = root.createDiv({ cls: 'claudian-inspector-activity' });
    this.activityEl.setAttribute('aria-live', 'polite');
    this.activityIconEl = this.activityEl.createSpan({ cls: 'claudian-inspector-activity-icon' });
    this.activityIconEl.setAttribute('aria-hidden', 'true');
    this.activityTextEl = this.activityEl.createSpan({ cls: 'claudian-inspector-activity-text' });

    this.statsEl = root.createEl('dl', { cls: 'claudian-inspector-stats' });

    this.bodyEl = root.createDiv({ cls: 'claudian-inspector-body' });
    const streamEl = this.bodyEl.createEl('section', { cls: 'claudian-inspector-stream' });
    streamEl.setAttribute('aria-label', 'Ablauf');
    this.listEl = streamEl.createEl('ol', { cls: 'claudian-inspector-timeline' });
    this.liveTailEl = streamEl.createDiv({ cls: 'claudian-inspector-live-tail' });
    this.liveTailEl.createSpan({ cls: 'claudian-inspector-live-dots' }).setAttribute('aria-hidden', 'true');
    this.liveTailEl.createSpan({ cls: 'claudian-inspector-live-text', text: 'Arbeitet …' });

    const asideEl = this.bodyEl.createEl('aside', { cls: 'claudian-inspector-aside' });
    this.filesSectionEl = asideEl.createEl('section', { cls: 'claudian-inspector-aside-section' });
    this.filesSectionEl.createEl('h2', { cls: 'claudian-inspector-aside-title', text: 'Dateien' });
    this.filesEl = this.filesSectionEl.createEl('ul', { cls: 'claudian-inspector-files' });
    const trailSectionEl = asideEl.createEl('section', { cls: 'claudian-inspector-aside-section' });
    trailSectionEl.createEl('h2', { cls: 'claudian-inspector-aside-title', text: 'Werkzeug-Spur' });
    this.trailEl = trailSectionEl.createDiv({ cls: 'claudian-inspector-trail' });
    this.trailEl.setAttribute('aria-hidden', 'true');

    const footerEl = root.createDiv({ cls: 'claudian-inspector-footer' });
    const followLabel = footerEl.createEl('label', { cls: 'claudian-inspector-follow' });
    this.followInput = followLabel.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
    this.followInput.checked = true;
    followLabel.createSpan({ text: 'Live folgen' });
    this.followInput.addEventListener('change', () => {
      this.setFollowing(this.followInput.checked);
      if (this.following) this.scrollToEnd();
    });

    this.emptyEl = root.createDiv({ cls: 'claudian-inspector-empty claudian-hidden' });
    this.emptyEl.createDiv({ cls: 'claudian-inspector-empty-title', text: 'Dieser Subagent ist nicht mehr verfügbar.' });
    this.emptyEl.createDiv({
      cls: 'claudian-inspector-empty-hint',
      text: 'Sein Chat wurde gelöscht oder ist noch nicht geladen. Öffne den Chat, um ihn wieder live zu sehen.',
    });
  }

  render(info: SubagentInfo | undefined, context: InspectorContext): void {
    this.info = info;
    this.context = context;
    const missing = !info;
    this.emptyEl.toggleClass('claudian-hidden', !missing);
    for (const el of [this.heroEl, this.activityEl, this.statsEl, this.bodyEl]) {
      el.toggleClass('claudian-hidden', missing);
    }
    if (!info) return;

    const phase = displayPhase(info, context);
    this.root.setAttribute('data-phase', phase);
    if (info.providerId) {
      this.root.setAttribute('data-provider', info.providerId);
      // Provenance color outside the chat container, where --claudian-brand
      // names the active provider rather than this agent's.
      this.root.setCssProps({ '--inspector-provider': `var(--claudian-brand-${info.providerId}, var(--cl-accent))` });
    }

    this.renderHero(info, phase);
    this.renderActivity(info, phase);
    this.renderStats(info);
    this.renderTranscript(info);
    this.renderFiles(info);
    this.renderTrail(info);
    this.liveTailEl.toggleClass('claudian-hidden', !(isLiveSubagentPhase(phase) && context.live));

    this.hasRendered = true;
    if (this.following) this.scrollToEnd();
  }

  /** Called every second while the view is open; only a live run's clock moves. */
  tick(now: number = Date.now()): void {
    if (!this.info) return;
    const live = this.context.live && isLiveSubagentPhase(displayPhase(this.info, this.context));
    const summary = summarizeSubagent(this.info, live ? now : this.info.completedAt ?? this.info.startedAt ?? now);
    this.elapsedEl.setText(summary.elapsedMs !== undefined ? formatSubagentDuration(summary.elapsedMs) : '');
  }

  destroy(): void {
    this.root.removeEventListener('scroll', this.onScroll);
    if (this.armTimer !== null) window.clearTimeout(this.armTimer);
    this.armTimer = null;
  }

  // ─── Hero ────────────────────────────────────────────────────────────────

  private renderHero(info: SubagentInfo, phase: SubagentPhase): void {
    this.titleEl.setText(subagentTitle(info));
    this.renderGlyph(phase);

    this.provenanceEl.empty();
    const provenance: string[] = [];
    if (this.context.providerLabel) {
      const providerEl = this.provenanceEl.createSpan({ cls: 'claudian-inspector-provider' });
      providerEl.createSpan({ cls: 'claudian-inspector-provider-dot' }).setAttribute('aria-hidden', 'true');
      providerEl.createSpan({ text: this.context.providerLabel });
    }
    if (info.agentType) provenance.push(info.agentType);
    if (info.model) provenance.push(info.model);
    provenance.push(modeLabel(info));
    // One flowing line: separators never start a wrapped line on their own.
    this.provenanceEl.createSpan({ cls: 'claudian-inspector-provenance-parts', text: provenance.join(' · ') });
    this.contextEl.toggleClass('claudian-hidden', !this.context.conversationTitle);
    this.contextTextEl.setText(this.context.conversationTitle ? `Chat: ${this.context.conversationTitle}` : '');

    const live = isLiveSubagentPhase(phase);
    this.phaseTextEl.setText(SUBAGENT_PHASE_LABELS[phase]);
    this.phaseEl.setAttribute('data-phase', phase);
    this.tick();

    const canShowStop = live && this.context.live;
    this.stopBtn.toggleClass('claudian-hidden', !canShowStop);
    if (canShowStop) this.renderStopButton(phase);
    this.locateBtn.toggleClass('claudian-hidden', !this.callbacks.onLocate);
  }

  private renderGlyph(phase: SubagentPhase): void {
    if (this.renderedGlyphPhase === phase) return;
    const settled = this.renderedGlyphPhase !== null;
    this.renderedGlyphPhase = phase;
    this.glyphEl.empty();
    this.glyphEl.setAttribute('data-phase', phase);
    const icon = PHASE_GLYPH_ICONS[phase];
    if (icon) {
      setIcon(this.glyphEl, icon);
      if (settled) this.glyphEl.addClass('is-settling');
    } else {
      this.glyphEl.createSpan({ cls: 'claudian-inspector-ring' });
    }
  }

  private renderStopButton(phase: SubagentPhase): void {
    if (this.armTimer !== null) return;
    const stopping = phase === 'stopping';
    const unavailable = this.context.stopScope === 'none';
    this.stopBtn.disabled = stopping || unavailable;
    this.stopLabelEl.setText(stopping ? 'Wird gestoppt …' : unavailable ? 'Nicht stoppbar' : 'Stoppen');
    const title = unavailable
      ? 'Dieser Anbieter kann Subagents nicht einzeln stoppen, und die Antwort ist schon beendet.'
      : this.context.stopScope === 'turn'
        ? 'Dieser Anbieter kann Subagents nicht einzeln stoppen – Stoppen beendet die ganze Antwort.'
        : 'Stoppt nur diesen Subagent; die Antwort läuft weiter.';
    this.stopBtn.setAttribute('title', title);
    this.stopBtn.setAttribute('aria-label', stopping ? 'Subagent wird gestoppt' : title);
  }

  private handleStopClick(): void {
    if (this.stopBtn.disabled) return;
    if (this.armTimer === null) {
      this.stopBtn.addClass('is-armed');
      this.stopLabelEl.setText(stopConfirmLabel(this.context.stopScope));
      this.stopBtn.setAttribute('aria-label', `${stopConfirmLabel(this.context.stopScope)} Zum Bestätigen erneut klicken.`);
      this.armTimer = window.setTimeout(() => this.disarmStop(), STOP_ARM_MS);
      return;
    }
    this.disarmStop();
    this.callbacks.onStop();
  }

  private disarmStop(): void {
    if (this.armTimer !== null) window.clearTimeout(this.armTimer);
    this.armTimer = null;
    this.stopBtn.removeClass('is-armed');
    if (this.info) this.renderStopButton(displayPhase(this.info, this.context));
  }

  // ─── Live line and counters ──────────────────────────────────────────────

  private renderActivity(info: SubagentInfo, phase: SubagentPhase): void {
    const activity = isLiveSubagentPhase(phase) ? describeSubagentActivity(info) : null;
    this.activityEl.toggleClass('claudian-hidden', !activity);
    if (!activity) return;
    if (this.activityTextEl.textContent === activity.text) return;
    this.activityIconEl.empty();
    if (activity.toolName) setToolIcon(this.activityIconEl, activity.toolName);
    else setIcon(this.activityIconEl, 'sparkles');
    this.activityTextEl.setText(activity.text);
  }

  private renderStats(info: SubagentInfo): void {
    const summary = summarizeSubagent(info);
    const stats: Array<[string, string]> = [
      ['Werkzeuge', summary.runningTools > 0 ? `${summary.toolCount} · ${summary.runningTools} aktiv` : String(summary.toolCount)],
      ['Fehler', String(summary.failedTools)],
      ['Tokens', summary.totalTokens ? formatSubagentTokens(summary.totalTokens).replace(' Tokens', '') : '–'],
      ['Dateien', String(summary.files.length)],
    ];
    const key = stats.map(([label, value]) => `${label}=${value}`).join('|');
    if (this.statsEl.getAttribute('data-key') === key) return;
    this.statsEl.setAttribute('data-key', key);
    this.statsEl.empty();
    for (const [label, value] of stats) {
      const item = this.statsEl.createDiv({ cls: 'claudian-inspector-stat' });
      item.createEl('dt', { cls: 'claudian-inspector-stat-label', text: label });
      item.createEl('dd', { cls: 'claudian-inspector-stat-value', text: value });
    }
  }

  // ─── Transcript ──────────────────────────────────────────────────────────

  private renderTranscript(info: SubagentInfo): void {
    const entries = buildSubagentTranscript(info);
    const wanted = new Set(entries.map(entry => entry.key));
    for (const [key, rendered] of this.entries) {
      if (!wanted.has(key)) {
        rendered.el.remove();
        this.entries.delete(key);
      }
    }

    let previous: HTMLElement | null = null;
    for (const entry of entries) {
      const signature = entrySignature(entry);
      let rendered = this.entries.get(entry.key);
      if (!rendered) {
        const el = this.listEl.createEl('li', { cls: `claudian-inspector-entry is-${entry.kind}` });
        if (this.hasRendered) el.addClass('is-new');
        rendered = { el, signature: '' };
        this.entries.set(entry.key, rendered);
      }
      if (rendered.signature !== signature) {
        this.drawEntry(rendered.el, entry);
        rendered.signature = signature;
      }
      // Keep DOM order equal to transcript order (a tool may be placed late).
      if (previous) {
        if (previous.nextSibling !== rendered.el) previous.after?.(rendered.el);
      } else if (this.listEl.firstChild !== rendered.el) {
        this.listEl.prepend(rendered.el);
      }
      previous = rendered.el;
    }
  }

  private drawEntry(el: HTMLElement, entry: SubagentTranscriptEntry): void {
    switch (entry.kind) {
      case 'prompt':
        el.empty();
        el.createDiv({ cls: 'claudian-inspector-entry-title', text: 'Auftrag' });
        el.createDiv({ cls: 'claudian-inspector-entry-text', text: entry.text });
        return;
      case 'text':
        el.empty();
        el.createDiv({ cls: 'claudian-inspector-entry-text', text: entry.text });
        return;
      case 'tool':
        this.drawTool(el, entry.tool);
        return;
      case 'result':
        el.empty();
        el.setAttribute('data-phase', entry.phase);
        el.createDiv({ cls: 'claudian-inspector-entry-title', text: RESULT_TITLES[entry.phase] ?? 'Ergebnis' });
        this.callbacks.renderMarkdown(entry.text, el.createDiv({ cls: 'claudian-inspector-result-body' }));
        return;
    }
  }

  private drawTool(el: HTMLElement, tool: ToolCallInfo): void {
    el.setAttribute('data-status', tool.status);
    let details = el.querySelector('.claudian-inspector-tool') as HTMLDetailsElement | null;
    const wasOpen = details?.open ?? false;
    el.empty();
    details = el.createEl('details', { cls: 'claudian-inspector-tool' }) as HTMLDetailsElement;
    details.open = wasOpen;
    const summaryEl = details.createEl('summary', { cls: 'claudian-inspector-tool-summary' });
    const iconEl = summaryEl.createSpan({ cls: 'claudian-inspector-tool-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, tool.name, tool.input ?? {});
    summaryEl.createSpan({ cls: 'claudian-inspector-tool-name', text: getToolName(tool.name, tool.input ?? {}) });
    summaryEl.createSpan({ cls: 'claudian-inspector-tool-target', text: getToolSummary(tool.name, tool.input ?? {}) });
    summaryEl.createSpan({ cls: 'claudian-inspector-tool-status', text: toolStatusLabel(tool.status) });

    const bodyEl = details.createDiv({ cls: 'claudian-inspector-tool-body' });
    const fill = (): void => {
      bodyEl.empty();
      if (!tool.result && tool.status === 'running') {
        bodyEl.createDiv({ cls: 'claudian-inspector-tool-pending', text: 'Läuft …' });
        return;
      }
      renderExpandedContent(bodyEl, tool.name, tool.result, tool.input);
    };
    // Tool output is rendered on demand; most entries are never opened.
    if (wasOpen) fill();
    details.addEventListener('toggle', () => {
      if (details?.open) fill();
    });
  }

  // ─── Aside ───────────────────────────────────────────────────────────────

  private renderFiles(info: SubagentInfo): void {
    const { files } = summarizeSubagent(info);
    this.filesSectionEl.toggleClass('claudian-hidden', files.length === 0);
    const key = files.join('\n');
    if (this.filesEl.getAttribute('data-key') === key) return;
    this.filesEl.setAttribute('data-key', key);
    this.filesEl.empty();
    for (const path of [...files].reverse()) {
      const item = this.filesEl.createEl('li');
      const button = item.createEl('button', {
        cls: 'claudian-inspector-file',
        attr: { type: 'button', title: path },
      });
      const iconEl = button.createSpan({ cls: 'claudian-inspector-file-icon' });
      iconEl.setAttribute('aria-hidden', 'true');
      setIcon(iconEl, 'file-text');
      const name = path.split(/[\\/]/).pop() ?? path;
      button.createSpan({ cls: 'claudian-inspector-file-name', text: name });
      button.createSpan({ cls: 'claudian-inspector-file-path', text: path });
      button.addEventListener('click', () => this.callbacks.onOpenFile?.(path));
    }
  }

  private renderTrail(info: SubagentInfo): void {
    const calls = info.toolCalls;
    const existing = Array.from(this.trailEl.children) as HTMLElement[];
    calls.forEach((call, index) => {
      const status = call.status === 'blocked' ? 'error' : call.status;
      const step = existing[index] ?? this.trailEl.createSpan({ cls: 'claudian-inspector-trail-step' });
      if (step.getAttribute('data-status') !== status) step.setAttribute('data-status', status);
    });
    for (const extra of existing.slice(calls.length)) extra.remove();
  }

  // ─── Follow ──────────────────────────────────────────────────────────────

  private setFollowing(following: boolean): void {
    this.following = following;
    this.followInput.checked = following;
    this.root.toggleClass('is-following', following);
  }

  private scrollToEnd(): void {
    // The scroll event our own jump fires must not read as the user leaving.
    this.selfScrolling = true;
    this.root.scrollTop = this.root.scrollHeight;
    window.requestAnimationFrame(() => {
      this.selfScrolling = false;
    });
  }
}

/**
 * A saved foreground run that still reads as running has no process behind it
 * any more; it ended with the chat. Background runs keep their state.
 */
function displayPhase(info: SubagentInfo, context: InspectorContext): SubagentPhase {
  const phase = resolveSubagentPhase(info);
  if (!context.live && isLiveSubagentPhase(phase) && info.mode !== 'async') return 'orphaned';
  return phase;
}

function toolStatusLabel(status: ToolCallInfo['status']): string {
  switch (status) {
    case 'running': return 'läuft';
    case 'completed': return 'fertig';
    case 'error': return 'Fehler';
    case 'blocked': return 'blockiert';
    default: return status;
  }
}

import { setIcon } from 'obsidian';

import type { ContextPressureLevel } from '../../../core/conversation/contextPressure';
import { t } from '../../../i18n/i18n';
import { formatTokenCount } from '../../../utils/formatTokenCount';

export interface ContextPressureViewState {
  level: Exclude<ContextPressureLevel, 'normal'>;
  percentage: number;
  contextTokens: number;
  contextWindow: number;
  /** The window or token count is a local estimate, not provider telemetry. */
  approximate: boolean;
  /** The provider's manual compact command, or null when it has none. */
  compactCommand: string | null;
  /** The provider compacts by itself before the window overflows. */
  autoCompact?: boolean;
  streaming: boolean;
  condensing: boolean;
}

export interface ContextPressureBannerCallbacks {
  onCompact: () => void;
  onContinueFresh: () => void;
  onDismiss: () => void;
}

const LEVEL_ICON: Record<ContextPressureViewState['level'], string> = {
  high: 'gauge',
  critical: 'alert-triangle',
};

/**
 * Warning above the composer when the active conversation nears its context
 * window. Pure view: the tab decides whether and what to show; this renders it
 * and reports intent. Level is carried by copy and icon as well as colour.
 */
export class ContextPressureBanner {
  private readonly rootEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly percentEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly usageEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly compactEl: HTMLButtonElement;
  private readonly freshEl: HTMLButtonElement;
  private readonly dismissEl: HTMLButtonElement;
  private readonly noteEl: HTMLElement;
  private renderedIcon: string | null = null;
  private visible = false;
  private actionsEnabled = false;

  constructor(mountEl: HTMLElement, callbacks: ContextPressureBannerCallbacks) {
    this.rootEl = mountEl.createEl('section', { cls: 'claudian-context-pressure claudian-hidden' });

    const mainEl = this.rootEl.createDiv({ cls: 'claudian-context-pressure-main' });
    this.iconEl = mainEl.createSpan({ cls: 'claudian-context-pressure-icon' });
    this.iconEl.setAttribute('aria-hidden', 'true');

    const bodyEl = mainEl.createDiv({ cls: 'claudian-context-pressure-body' });
    const headEl = bodyEl.createDiv({ cls: 'claudian-context-pressure-head' });
    this.titleEl = headEl.createSpan({ cls: 'claudian-context-pressure-title' });
    // Announced once per level change; the percentage alone would be chatty.
    this.titleEl.setAttribute('aria-live', 'polite');
    this.percentEl = headEl.createSpan({ cls: 'claudian-context-pressure-percent' });

    const meterEl = bodyEl.createDiv({ cls: 'claudian-context-pressure-meter' });
    meterEl.setAttribute('aria-hidden', 'true');
    this.fillEl = meterEl.createSpan({ cls: 'claudian-context-pressure-meter-fill' });

    const detailEl = bodyEl.createEl('p', { cls: 'claudian-context-pressure-detail' });
    this.usageEl = detailEl.createSpan({ cls: 'claudian-context-pressure-usage' });
    this.textEl = detailEl.createSpan({ cls: 'claudian-context-pressure-text' });

    this.dismissEl = mainEl.createEl('button', { cls: 'claudian-context-pressure-dismiss' });
    this.dismissEl.setAttribute('type', 'button');
    setIcon(this.dismissEl, 'x');
    this.dismissEl.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onDismiss();
    });

    const actionsEl = this.rootEl.createDiv({ cls: 'claudian-context-pressure-actions' });
    this.compactEl = this.createAction(actionsEl, 'claudian-context-pressure-action--compact', callbacks.onCompact);
    this.freshEl = this.createAction(actionsEl, 'claudian-context-pressure-action--fresh', callbacks.onContinueFresh);

    this.noteEl = this.rootEl.createEl('p', { cls: 'claudian-context-pressure-note claudian-hidden' });
  }

  private createAction(parent: HTMLElement, cls: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: `claudian-context-pressure-action ${cls}` });
    button.setAttribute('type', 'button');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.actionsEnabled) onClick();
    });
    return button;
  }

  render(state: ContextPressureViewState | null): void {
    if (!state) {
      this.visible = false;
      this.actionsEnabled = false;
      this.rootEl.addClass('claudian-hidden');
      return;
    }

    this.visible = true;
    this.rootEl.removeClass('claudian-hidden');
    // Labels are re-read on every render so a language change applies at once.
    this.rootEl.setAttribute('aria-label', t('chat.contextPressure.regionLabel'));
    this.dismissEl.setAttribute('aria-label', t('chat.contextPressure.dismiss'));
    this.dismissEl.setAttribute('title', t('chat.contextPressure.dismiss'));
    this.rootEl.setAttribute('data-level', state.level);
    this.rootEl.toggleClass('is-critical', state.level === 'critical');
    this.rootEl.toggleClass('is-estimated', state.approximate);
    this.rootEl.setAttribute('aria-busy', state.condensing ? 'true' : 'false');

    const icon = LEVEL_ICON[state.level];
    if (this.renderedIcon !== icon) {
      this.iconEl.empty();
      setIcon(this.iconEl, icon);
      this.renderedIcon = icon;
    }

    const critical = state.level === 'critical';
    this.titleEl.setText(t(critical || state.autoCompact ? 'chat.contextPressure.titleCritical' : 'chat.contextPressure.titleHigh'));
    const percent = Math.round(state.percentage);
    this.percentEl.setText(`${state.approximate ? '≈' : ''}${t('chat.contextPressure.percent', { percent })}`);
    this.fillEl.setCssProps({
      '--claudian-pressure-fill': String(Math.min(1, Math.max(0, percent / 100))),
    });

    const usageParams = {
      used: formatTokenCount(state.contextTokens),
      total: formatTokenCount(state.contextWindow),
    };
    this.usageEl.setText(t(
      state.approximate ? 'chat.contextPressure.usageEstimated' : 'chat.contextPressure.usage',
      usageParams,
    ));
    this.textEl.setText(t(state.autoCompact
      ? 'chat.contextPressure.bodyAutoCompact'
      : critical ? 'chat.contextPressure.bodyCritical' : 'chat.contextPressure.bodyHigh'));

    this.renderActions(state);
  }

  private renderActions(state: ContextPressureViewState): void {
    this.actionsEnabled = !state.streaming && !state.condensing;
    const hasCompact = state.compactCommand !== null;

    this.compactEl.toggleClass('claudian-hidden', !hasCompact);
    this.compactEl.toggleClass('is-primary', hasCompact);
    this.compactEl.setText(t('chat.contextPressure.compact'));
    if (hasCompact) {
      this.compactEl.setAttribute('title', t('chat.contextPressure.compactHint', { command: state.compactCommand! }));
    }

    this.freshEl.toggleClass('is-primary', !hasCompact);
    this.freshEl.toggleClass('is-busy', state.condensing);
    this.freshEl.setText(t(state.condensing ? 'chat.contextPressure.condensing' : 'chat.contextPressure.continueFresh'));
    this.freshEl.setAttribute('title', t('chat.contextPressure.continueFreshHint'));

    for (const button of [this.compactEl, this.freshEl]) {
      button.disabled = !this.actionsEnabled;
      button.setAttribute('aria-disabled', this.actionsEnabled ? 'false' : 'true');
    }

    this.noteEl.toggleClass('claudian-hidden', !state.streaming);
    this.noteEl.setText(state.streaming ? t('chat.contextPressure.streamingNote') : '');
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.rootEl.remove();
  }
}

import { setIcon } from 'obsidian';

import { type ClassifiedError, statusCardLabels, type StatusSeverity } from './errorClassification';

/**
 * Renders a polished, accessible "status card" for an error / warning / info
 * event — replacing the bare red "❌ Error: …" line. Severity drives icon,
 * color, and ARIA semantics; limit/quota events get a calmer warning treatment
 * with an actionable hint and a collapsible raw-details disclosure.
 */

const SEVERITY_ICON: Record<StatusSeverity, string> = {
  error: 'circle-alert',
  warning: 'triangle-alert',
  info: 'info',
};

function applyAriaSemantics(card: HTMLElement, severity: StatusSeverity): void {
  if (severity === 'error') {
    card.setAttribute('role', 'alert');
    return;
  }
  // Warnings/info are non-interrupting: announce politely.
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
}

export function renderStatusCard(parent: HTMLElement, classified: ClassifiedError): HTMLElement {
  const labels = statusCardLabels();

  const card = parent.createDiv({
    cls: `claudian-status-card claudian-status-card--${classified.severity}`,
  });
  applyAriaSemantics(card, classified.severity);

  const header = card.createDiv({ cls: 'claudian-status-card-header' });
  const iconEl = header.createSpan({ cls: 'claudian-status-card-icon' });
  setIcon(iconEl, SEVERITY_ICON[classified.severity]);

  const heading = header.createDiv({ cls: 'claudian-status-card-heading' });
  heading.createSpan({ cls: 'claudian-status-card-title', text: classified.title });
  if (classified.isLimit) {
    heading.createSpan({ cls: 'claudian-status-card-badge', text: labels.limitBadge });
  }

  if (classified.explanation) {
    card.createEl('p', {
      cls: 'claudian-status-card-explanation',
      text: classified.explanation,
    });
  }

  if (classified.hint) {
    const hint = card.createDiv({ cls: 'claudian-status-card-hint' });
    const hintIcon = hint.createSpan({ cls: 'claudian-status-card-hint-icon' });
    setIcon(hintIcon, 'lightbulb');
    hint.createSpan({ cls: 'claudian-status-card-hint-text', text: classified.hint });
  }

  // Keep the cryptic original available without letting it dominate. Skip when
  // the raw text already IS the explanation (notices), to avoid duplication.
  if (classified.raw && classified.raw !== classified.explanation) {
    const details = card.createEl('details', { cls: 'claudian-status-card-raw' });
    details.createEl('summary', {
      cls: 'claudian-status-card-raw-summary',
      text: labels.rawDetails,
    });
    // `text` sets textContent → raw content is escaped, never parsed as HTML.
    details.createEl('pre', { cls: 'claudian-status-card-raw-body', text: classified.raw });
  }

  return card;
}

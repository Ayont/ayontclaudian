import { setIcon } from 'obsidian';

/**
 * Obsidian status-bar item showing, for the active chat's provider:
 * - the provider (a brand-colored dot + name),
 * - whether it is set up / ready to use (CLI resolves + enabled),
 * - the current context-window usage percent, when known.
 *
 * NOTE: account-level rate-limit / quota percentages are NOT exposed by the
 * provider CLIs (Claude/Codex/Kimi/Antigravity/Opencode/Pi report no quota), so
 * the percent shown here is the conversation's CONTEXT-WINDOW usage — the real,
 * available "how much room is left this turn" signal. The bar lives outside
 * `.claudian-container`, so it uses inline brand colors + Obsidian theme vars
 * rather than the `--cl-*` design tokens.
 */

/** Brand accent per provider (mirrors variables.css; inline because the status
 *  bar is outside the token scope). */
const PROVIDER_COLOR: Record<string, string> = {
  claude: '#D97757',
  codex: '#9aa0a6',
  opencode: '#B8B8B8',
  pi: '#cfcfcf',
  kimi: '#7C6CF2',
  antigravity: '#4286F4',
  vibe: '#FF7A00',
  grok: '#E8E8E8',
};

export interface ProviderStatus {
  providerId: string;
  name: string;
  /** Enabled in settings AND the CLI binary resolves (set up / usable). */
  ready: boolean;
  /** Enabled in settings (regardless of whether the CLI was found). */
  enabled: boolean;
  /** True while the provider is actively generating a response this turn. */
  streaming: boolean;
  /** Context-window usage percent (0–100), or null when unknown. */
  percentage: number | null;
  /** True when the percent is an estimate (Kimi/Antigravity). */
  estimated: boolean;
}

/** Short status word for the ready/enabled state. Pure, for testing. */
export function readyWord(status: Pick<ProviderStatus, 'ready' | 'enabled'>): string {
  if (!status.enabled) {
    return 'aus';
  }
  return status.ready ? 'bereit' : 'Setup nötig';
}

/** State word incl. the live "generating" state. Pure, for testing. */
export function stateWord(status: Pick<ProviderStatus, 'ready' | 'enabled' | 'streaming'>): string {
  return status.streaming ? 'generiert…' : readyWord(status);
}

/** Builds the tooltip detail string. Pure, for testing. */
export function formatStatusTooltip(status: ProviderStatus): string {
  const parts = [`${status.name}: ${stateWord(status)}`];
  if (!status.streaming && !status.ready && status.enabled) {
    parts.push('CLI nicht gefunden — Pfad/Login in den Einstellungen prüfen');
  }
  if (status.percentage !== null) {
    parts.push(`Kontext ${status.estimated ? '≈' : ''}${status.percentage}% belegt`);
  }
  return parts.join(' · ');
}

export class ProviderStatusBar {
  private readonly el: HTMLElement;
  private dotEl: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private stateEl: HTMLElement | null = null;
  private pctEl: HTMLElement | null = null;

  constructor(statusBarEl: HTMLElement) {
    this.el = statusBarEl;
    this.el.addClass('claudian-statusbar');
    this.render();
  }

  private render(): void {
    this.el.empty();
    this.dotEl = this.el.createSpan({ cls: 'claudian-statusbar-dot' });
    this.nameEl = this.el.createSpan({ cls: 'claudian-statusbar-name' });
    this.stateEl = this.el.createSpan({ cls: 'claudian-statusbar-state' });
    this.pctEl = this.el.createSpan({ cls: 'claudian-statusbar-pct' });
  }

  /** Renders the active provider's status, or hides the bar when none. */
  update(status: ProviderStatus | null): void {
    if (!status) {
      this.el.addClass('claudian-hidden');
      return;
    }
    this.el.removeClass('claudian-hidden');

    const brand = PROVIDER_COLOR[status.providerId] ?? 'var(--text-muted)';

    if (this.dotEl) {
      // While generating, spin a loader in the brand color; otherwise a solid
      // (ready) or hollow (not set up) dot.
      this.dotEl.style.color = status.streaming || status.ready ? brand : 'var(--text-faint)';
      this.dotEl.toggleClass('spin', status.streaming);
      setIcon(this.dotEl, status.streaming ? 'loader-2' : status.ready ? 'circle' : 'circle-off');
    }

    this.nameEl?.setText(status.name);

    if (this.stateEl) {
      this.stateEl.setText(stateWord(status));
      this.stateEl.toggleClass('is-streaming', status.streaming);
      this.stateEl.toggleClass('is-ready', !status.streaming && status.ready);
      this.stateEl.toggleClass('is-setup', !status.streaming && status.enabled && !status.ready);
      this.stateEl.toggleClass('is-off', !status.streaming && !status.enabled);
    }

    if (this.pctEl) {
      if (status.percentage !== null) {
        this.pctEl.setText(`${status.estimated ? '≈' : ''}${status.percentage}%`);
        this.pctEl.toggleClass('claudian-hidden', false);
        this.pctEl.toggleClass('is-warning', status.percentage > 80);
      } else {
        this.pctEl.toggleClass('claudian-hidden', true);
      }
    }

    this.el.setAttribute('aria-label', formatStatusTooltip(status));
    this.el.setAttribute('data-tooltip', formatStatusTooltip(status));
  }

  destroy(): void {
    this.el.empty();
    this.el.removeClass('claudian-statusbar');
  }
}

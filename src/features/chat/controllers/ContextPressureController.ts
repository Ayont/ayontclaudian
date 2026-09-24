import {
  type ContextPressureDismissal,
  dismissContextPressure,
  isContextPressureVisible,
  resolveContextPressureLevel,
} from '../../../core/conversation/contextPressure';
import { resolveCompactCommand } from '../../../core/providers/compactSupport';
import type { ProviderCompactSupport, ProviderId } from '../../../core/providers/types';
import { isPlausibleContextUsage } from '../../../core/providers/usage/consumedTokens';
import type { UsageInfo } from '../../../core/types';
import type { ContextPressureViewState } from '../ui/ContextPressureBanner';

export interface ContextPressureControllerDeps {
  view: { render(state: ContextPressureViewState | null): void };
  getProviderId(): ProviderId;
  getCompactSupport(): Readonly<ProviderCompactSupport> | undefined;
  getUsage(): UsageInfo | null;
  isStreaming(): boolean;
  getConversationId(): string | null;
  /**
   * Commands the running agent advertised. Only asked for providers whose
   * compact command is advertised, and must never start a CLI to answer.
   */
  loadAdvertisedCommands(): Promise<ReadonlyArray<{ name: string }> | null>;
  onCompactCommandChange(command: string | null): void;
  sendCompact(command: string): Promise<void> | void;
  continueWithLessContext(): Promise<void>;
  notifyError?(message: string): void;
  /** The provider compacts on its own before the window overflows (capabilities.autoCompact). */
  getAutoCompacts?(): boolean;
}

/**
 * Consumer relays are not coding agents: no automatic context handling and
 * no session reset on their behalf (see the relay rules in CLAUDE.md).
 */
const DESKTOP_RELAY_PROVIDERS: ReadonlySet<ProviderId> = new Set(['grok-bot', 'perplexity-chat']);

/**
 * Dismissals live per conversation and in memory only: a restart shows the
 * warning again, and two tabs on the same chat agree.
 */
const dismissalsByConversation = new Map<string, ContextPressureDismissal>();

export class ContextPressureController {
  private compactCommand: string | null = null;
  private compactResolvedFor: ProviderId | null = null;
  private compactLoadToken = 0;
  private condensing = false;
  private unboundDismissal: ContextPressureDismissal | null = null;

  constructor(private readonly deps: ContextPressureControllerDeps) {}

  refresh(): void {
    const providerId = this.deps.getProviderId();
    const usage = this.deps.getUsage();
    if (DESKTOP_RELAY_PROVIDERS.has(providerId) || !usage || !isPlausibleContextUsage(usage)) {
      this.deps.view.render(null);
      return;
    }

    const level = resolveContextPressureLevel(usage.percentage);
    if (level === 'normal') {
      this.setDismissal(null);
      this.deps.view.render(null);
      return;
    }
    // A provider that compacts by itself handles "high" on its own; near the
    // limit the banner only says so, in the calm style, actions kept.
    const autoCompact = this.deps.getAutoCompacts?.() === true;
    if (autoCompact && level === 'high' && !this.condensing) {
      this.deps.view.render(null);
      return;
    }

    this.syncCompactCommand(providerId);
    if (!this.condensing && !isContextPressureVisible(usage.percentage, this.getDismissal())) {
      this.deps.view.render(null);
      return;
    }

    this.deps.view.render({
      level: autoCompact ? 'high' : level,
      ...(autoCompact ? { autoCompact } : {}),
      percentage: usage.percentage,
      contextTokens: usage.contextTokens,
      contextWindow: usage.contextWindow,
      approximate: usage.contextWindowIsAuthoritative === false,
      compactCommand: this.compactCommand,
      streaming: this.deps.isStreaming(),
      condensing: this.condensing,
    });
  }

  /** Forget the resolved compact command, e.g. after a provider switch or a finished turn. */
  invalidateCompactCommand(): void {
    this.compactResolvedFor = null;
    this.compactLoadToken += 1;
  }

  dismiss(): void {
    const usage = this.deps.getUsage();
    if (usage) {
      this.setDismissal(dismissContextPressure(usage.percentage));
    }
    this.refresh();
  }

  async compact(): Promise<void> {
    const command = this.compactCommand;
    if (!command || this.condensing || this.deps.isStreaming()) {
      return;
    }
    // Step aside while compaction runs; a stale high usage report must not
    // bring the warning straight back before the provider reports new usage.
    this.dismiss();
    await this.deps.sendCompact(command);
  }

  async continueWithLessContext(): Promise<void> {
    if (this.condensing || this.deps.isStreaming()) {
      return;
    }
    this.condensing = true;
    this.refresh();
    try {
      await this.deps.continueWithLessContext();
    } catch (error) {
      this.deps.notifyError?.(error instanceof Error ? error.message : String(error));
    } finally {
      this.condensing = false;
      this.setDismissal(null);
      this.invalidateCompactCommand();
      this.refresh();
    }
  }

  private syncCompactCommand(providerId: ProviderId): void {
    if (this.compactResolvedFor === providerId) {
      return;
    }
    const support = this.deps.getCompactSupport();
    if (support?.availability !== 'advertised') {
      this.compactResolvedFor = providerId;
      this.setCompactCommand(resolveCompactCommand(support, null));
      return;
    }

    this.compactResolvedFor = providerId;
    this.setCompactCommand(null);
    const token = ++this.compactLoadToken;
    void this.deps.loadAdvertisedCommands()
      .catch(() => null)
      .then((commands) => {
        if (token !== this.compactLoadToken || this.deps.getProviderId() !== providerId) {
          return;
        }
        this.setCompactCommand(resolveCompactCommand(support, commands));
        this.refresh();
      });
  }

  private setCompactCommand(command: string | null): void {
    this.compactCommand = command;
    this.deps.onCompactCommandChange(command);
  }

  private getDismissal(): ContextPressureDismissal | null {
    const conversationId = this.deps.getConversationId();
    return conversationId
      ? dismissalsByConversation.get(conversationId) ?? null
      : this.unboundDismissal;
  }

  private setDismissal(dismissal: ContextPressureDismissal | null): void {
    const conversationId = this.deps.getConversationId();
    if (!conversationId) {
      this.unboundDismissal = dismissal;
      return;
    }
    if (dismissal) {
      dismissalsByConversation.set(conversationId, dismissal);
    } else {
      dismissalsByConversation.delete(conversationId);
    }
  }
}

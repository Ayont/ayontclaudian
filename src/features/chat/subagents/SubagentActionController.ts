import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { SubagentCancelTarget, SubagentInfo } from '../../../core/types';
import type { SubagentManager } from '../services/SubagentManager';
import { isLiveSubagentPhase, resolveSubagentPhase } from './subagentPresentation';

/**
 * What "Stop" does for one subagent:
 * - `agent`: the provider stops exactly this subagent; the answer continues.
 * - `turn`:  the provider has no per-subagent stop; stopping ends the answer.
 * - `none`:  neither is possible any more (answer already finished).
 */
export type SubagentStopScope = 'agent' | 'turn' | 'none';

export type SubagentStopOutcome = 'stopped' | 'turn-stopped' | 'failed' | 'unavailable';

export interface SubagentActionDeps {
  getManager: () => SubagentManager;
  getRuntime: () => ChatRuntime | null;
  isStreaming: () => boolean;
  cancelTurn: () => void;
  openInspector: (subagentId: string) => void;
  providerLabel: () => string;
  notify: (message: string) => void;
}

/** How long an armed Stop button waits for its confirming second click. */
export const STOP_ARM_MS = 4_000;

const ACTION_SELECTOR = '[data-subagent-action]';
const CARD_SELECTOR = '[data-subagent-card-id]';

export function toCancelTarget(info: SubagentInfo): SubagentCancelTarget {
  return {
    id: info.id,
    ...(info.taskId ? { taskId: info.taskId } : {}),
    ...(info.agentId ? { agentId: info.agentId } : {}),
    ...(info.mode ? { mode: info.mode } : {}),
  };
}

export function stopConfirmLabel(scope: SubagentStopScope): string {
  return scope === 'agent' ? 'Stoppen?' : 'Ganze Antwort stoppen?';
}

/**
 * Stop and inspect for every subagent surface of one chat tab. The inline
 * cards reach it through click delegation; the swarm panel and the inspector
 * tab call it directly, so all three stop a subagent the same way.
 */
export class SubagentActionController {
  private readonly armTimers = new Map<HTMLElement, number>();
  private detach: (() => void) | null = null;

  constructor(private readonly deps: SubagentActionDeps) {}

  resolveStopScope(subagentId: string): SubagentStopScope {
    const info = this.deps.getManager().getSubagentById(subagentId);
    if (!info || !isLiveSubagentPhase(resolveSubagentPhase(info))) return 'none';
    const runtime = this.deps.getRuntime();
    if (runtime?.canCancelSubagent?.(toCancelTarget(info)) && runtime.cancelSubagent) return 'agent';
    // Ending the answer does not end a background agent; do not promise it.
    if (info.mode === 'async') return 'none';
    return this.deps.isStreaming() ? 'turn' : 'none';
  }

  async stop(subagentId: string): Promise<SubagentStopOutcome> {
    const manager = this.deps.getManager();
    const info = manager.getSubagentById(subagentId);
    const scope = this.resolveStopScope(subagentId);
    if (!info || scope === 'none') {
      if (info) {
        this.deps.notify(info.mode === 'async'
          ? `${this.deps.providerLabel()} kann diesen Hintergrund-Subagent gerade nicht einzeln stoppen.`
          : `${this.deps.providerLabel()} kann diesen Subagent gerade nicht einzeln stoppen, und die Antwort ist schon beendet.`);
      }
      return 'unavailable';
    }

    manager.requestCancel(subagentId);
    if (scope === 'turn') {
      this.deps.cancelTurn();
      return 'turn-stopped';
    }

    const delivered = await this.deps.getRuntime()?.cancelSubagent?.(toCancelTarget(info)) ?? false;
    if (!delivered) {
      manager.clearCancelRequest(subagentId);
      this.deps.notify('Stoppen fehlgeschlagen – der Subagent läuft weiter.');
      return 'failed';
    }
    return 'stopped';
  }

  /** Listens for card actions under `rootEl`; returns the detach function. */
  attach(rootEl: HTMLElement): () => void {
    const onClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.(ACTION_SELECTOR) as HTMLElement | null;
      if (!button || !rootEl.contains(button)) return;
      const subagentId = (button.closest(CARD_SELECTOR) as HTMLElement | null)?.getAttribute('data-subagent-card-id');
      if (!subagentId) return;
      event.preventDefault();
      event.stopPropagation();
      void this.handleAction(button, button.getAttribute('data-subagent-action') ?? '', subagentId);
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.armTimers.size > 0) {
        this.disarmAll();
        event.stopPropagation();
      }
    };
    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('keydown', onKeydown);
    const detach = (): void => {
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('keydown', onKeydown);
      this.disarmAll();
      if (this.detach === detach) this.detach = null;
    };
    this.detach = detach;
    return detach;
  }

  /** Detaches from the chat and clears armed buttons; called when the tab closes. */
  dispose(): void {
    this.detach?.();
    this.disarmAll();
  }

  async handleAction(button: HTMLElement, action: string, subagentId: string): Promise<void> {
    if (action === 'inspect') {
      this.deps.openInspector(subagentId);
      return;
    }
    if (action !== 'stop') return;

    // First click arms and says what will happen; the second one stops.
    if (!this.armTimers.has(button)) {
      const scope = this.resolveStopScope(subagentId);
      if (scope === 'none') {
        await this.stop(subagentId);
        return;
      }
      this.arm(button, scope);
      return;
    }
    this.disarm(button);
    await this.stop(subagentId);
  }

  private arm(button: HTMLElement, scope: SubagentStopScope): void {
    const label = stopConfirmLabel(scope);
    button.addClass('is-armed');
    button.setAttribute('data-stop-scope', scope);
    button.setAttribute('aria-label', `${label} Zum Bestätigen erneut klicken.`);
    button.querySelector('.claudian-subagent-action-label')?.setText(label);
    const timer = window.setTimeout(() => this.disarm(button), STOP_ARM_MS);
    this.armTimers.set(button, timer);
  }

  private disarm(button: HTMLElement): void {
    const timer = this.armTimers.get(button);
    if (timer !== undefined) window.clearTimeout(timer);
    this.armTimers.delete(button);
    button.removeClass('is-armed');
    button.removeAttribute('data-stop-scope');
    button.setAttribute('aria-label', 'Subagent stoppen');
    button.querySelector('.claudian-subagent-action-label')?.setText('');
  }

  disarmAll(): void {
    for (const button of [...this.armTimers.keys()]) this.disarm(button);
  }
}

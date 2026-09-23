/**
 * Mounts goal fixtures with the production GoalBanner and round divider.
 * goal.spec.ts bundles this file (obsidian → obsidianShim) into
 * components.html, so the screenshots show what the chat renders.
 */
import type { NativeGoalCapability } from '../../src/core/providers/types';
import type { NativeGoalState } from '../../src/core/types';
import { renderGoalRoundBoundary } from '../../src/features/chat/rendering/goalRoundBoundary';
import { GoalBanner } from '../../src/features/chat/ui/GoalBanner';

const CODEX: NativeGoalCapability = { mode: 'rpc', canPause: true, persistent: true, resume: 'rpc' };
const CLAUDE: NativeGoalCapability = { mode: 'slash', canPause: false, persistent: false, clearCommand: '/goal clear', resume: 'next-turn' };

const OBJECTIVE = 'Alle Provider-Tests grün, Lint ohne Fehler und die Release-Notiz geschrieben';

type Fixture = {
  provider: string;
  providerLabel: string;
  state: NativeGoalState | null;
  capability: NativeGoalCapability | null;
  loopLabel?: string;
};

const FIXTURES: Record<string, Fixture> = {
  'codex-live': {
    provider: 'codex',
    providerLabel: 'Codex',
    state: { objective: OBJECTIVE, status: 'active', round: 3, tokensUsed: 41_800, tokenBudget: 120_000, timeUsedSeconds: 540 },
    capability: CODEX,
  },
  'claude-round': {
    provider: 'claude',
    providerLabel: 'Claude',
    state: { objective: OBJECTIVE, status: 'active', round: 2, lastReason: 'Zwei Tests in SessionStorage schlagen noch fehl, die Release-Notiz fehlt.' },
    capability: CLAUDE,
  },
  'codex-complete': {
    provider: 'codex',
    providerLabel: 'Codex',
    state: { objective: OBJECTIVE, status: 'complete', tokensUsed: 88_400, tokenBudget: 120_000 },
    capability: CODEX,
  },
  'codex-budget': {
    provider: 'codex',
    providerLabel: 'Codex',
    state: { objective: OBJECTIVE, status: 'budget_limited', tokensUsed: 121_300, tokenBudget: 120_000 },
    capability: CODEX,
  },
  'kimi-blocked': {
    provider: 'kimi',
    providerLabel: 'Kimi',
    state: { objective: OBJECTIVE, status: 'blocked' },
    capability: { mode: 'slash', canPause: false, persistent: true, resume: 'resend' },
  },
  'codex-paused': {
    provider: 'codex',
    providerLabel: 'Codex',
    state: { objective: OBJECTIVE, status: 'paused', tokensUsed: 12_000, tokenBudget: null },
    capability: CODEX,
  },
  'grok-loop': {
    provider: 'grok',
    providerLabel: 'Grok',
    state: null,
    capability: null,
    loopLabel: 'Claudian-Loop',
  },
};

function mountBanners(): void {
  document.querySelectorAll<HTMLElement>('[data-goal-fixture]').forEach((host) => {
    const fixture = FIXTURES[host.dataset.goalFixture ?? ''];
    if (!fixture) return;
    host.replaceChildren();
    host.dataset.provider = fixture.provider;
    const banner = new GoalBanner({
      mountEl: host,
      onClear: () => undefined,
      onDone: () => undefined,
      onTogglePause: () => undefined,
      onNativeTogglePause: () => undefined,
      onEdit: () => undefined,
    });
    banner.setGoal(fixture.state?.objective ?? OBJECTIVE, fixture.providerLabel, fixture.loopLabel);
    banner.setNative(fixture.state, fixture.capability);
    if (!fixture.state) banner.setPaused(false);
  });
}

function mountRounds(): void {
  document.querySelectorAll<HTMLElement>('[data-goal-rounds]').forEach((host) => {
    host.replaceChildren();
    const text = (content: string) => {
      const el = host.ownerDocument.createElement('div');
      el.className = 'claudian-text-block';
      el.textContent = content;
      host.appendChild(el);
    };
    text('Die Normalisierung ist umgesetzt; ich starte die Tests.');
    renderGoalRoundBoundary(host, 2, 'Zwei Tests in SessionStorage schlagen noch fehl, die Release-Notiz fehlt noch komplett und muss geschrieben werden.');
    text('Beide Tests laufen jetzt durch. Weiter mit der Release-Notiz.');
    renderGoalRoundBoundary(host, 3);
    text('Release-Notiz geschrieben.');
  });
}

(window as unknown as { __mountGoalFixtures: () => void }).__mountGoalFixtures = () => {
  mountBanners();
  mountRounds();
};

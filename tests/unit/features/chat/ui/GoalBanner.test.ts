import { createMockEl } from '@test/helpers/mockElement';

import { GoalBanner } from '@/features/chat/ui/GoalBanner';

function createBanner(): {
  banner: GoalBanner;
  mount: ReturnType<typeof createMockEl>;
  onClear: jest.Mock;
} {
  const mount = createMockEl();
  const onClear = jest.fn();
  const banner = new GoalBanner({ mountEl: mount as any, onClear });
  return { banner, mount, onClear };
}

describe('GoalBanner', () => {
  it('renders hidden and inactive by default', () => {
    const { banner, mount } = createBanner();
    const root = mount.querySelector('.claudian-goal-banner');
    expect(root).not.toBeNull();
    expect(root?.hasClass('claudian-hidden')).toBe(true);
    expect(banner.isActive()).toBe(false);
  });

  it('shows the goal text and provider label when set', () => {
    const { banner, mount } = createBanner();
    banner.setGoal('ship 2.5.0', 'Claude');

    const root = mount.querySelector('.claudian-goal-banner');
    expect(root?.hasClass('claudian-hidden')).toBe(false);
    expect(banner.isActive()).toBe(true);
    expect(mount.querySelector('.claudian-goal-banner-text')?.textContent).toBe('ship 2.5.0');
    expect(mount.querySelector('.claudian-goal-banner-provider')?.textContent).toBe('Claude');
  });

  it('hides the provider chip when the label is empty', () => {
    const { mount } = createBanner();
    const banner2 = new GoalBanner({ mountEl: mount as any, onClear: jest.fn() });
    banner2.setGoal('do the thing', '');
    const provider = mount.querySelectorAll('.claudian-goal-banner-provider').at(-1);
    expect(provider?.hasClass('claudian-hidden')).toBe(true);
  });

  it('clears the goal and hides again', () => {
    const { banner, mount } = createBanner();
    banner.setGoal('temp', 'Kimi');
    banner.clear();

    const root = mount.querySelector('.claudian-goal-banner');
    expect(root?.hasClass('claudian-hidden')).toBe(true);
    expect(banner.isActive()).toBe(false);
    expect(mount.querySelector('.claudian-goal-banner-text')?.textContent).toBe('');
  });

  it('invokes onClear when the clear button is clicked', () => {
    const { mount, onClear } = createBanner();
    const clearBtn = mount.querySelector('.claudian-goal-banner-clear');
    clearBtn?.dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// The banner is the only place the loop can be paused without typing a command,
// so every `/goal` sub-command needs an affordance here.
describe('GoalBanner actions', () => {
  function createFullBanner() {
    const mount = createMockEl();
    const onClear = jest.fn();
    const onDone = jest.fn();
    const onTogglePause = jest.fn();
    const banner = new GoalBanner({
      mountEl: mount as any,
      onClear,
      onDone,
      onTogglePause,
    });
    const actions = mount.querySelectorAll('.claudian-goal-banner-action');
    return { actions, banner, mount, onClear, onDone, onTogglePause };
  }

  it('renders pause, done and clear in that order', () => {
    const { actions } = createFullBanner();

    expect(actions).toHaveLength(3);
    expect(actions[2].hasClass('claudian-goal-banner-clear')).toBe(true);
    expect(actions[1].hasClass('claudian-goal-banner-action--done')).toBe(true);
  });

  it('omits the optional actions when no handler is supplied', () => {
    const mount = createMockEl();
    new GoalBanner({ mountEl: mount as any, onClear: jest.fn() });

    expect(mount.querySelectorAll('.claudian-goal-banner-action')).toHaveLength(1);
  });

  it('asks to pause while running and to resume while paused', () => {
    const { actions, banner, onTogglePause } = createFullBanner();

    actions[0].dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(onTogglePause).toHaveBeenLastCalledWith(true);

    banner.setPaused(true);
    actions[0].dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(onTogglePause).toHaveBeenLastCalledWith(false);
  });

  it('invokes onDone from the check button', () => {
    const { actions, onDone } = createFullBanner();

    actions[1].dispatchEvent({ type: 'click', stopPropagation: () => {} });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('marks the banner and its label as paused', () => {
    const { banner, mount } = createFullBanner();
    banner.setGoal('ship it', 'Cline');

    banner.setPaused(true);

    const root = mount.querySelector('.claudian-goal-banner');
    expect(root?.hasClass('is-paused')).toBe(true);
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Ziel pausiert');

    banner.setPaused(false);
    expect(root?.hasClass('is-paused')).toBe(false);
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Ziel aktiv');
  });

  it('keeps the pause button label in sync for screen readers', () => {
    const { actions, banner } = createFullBanner();

    expect(actions[0].getAttribute('aria-label')).toBe('Zielschleife pausieren');

    banner.setPaused(true);

    expect(actions[0].getAttribute('aria-label')).toBe('Zielschleife fortsetzen');
    expect(actions[0].hasClass('is-paused')).toBe(true);
  });
});

describe('GoalBanner with a provider-owned goal', () => {
  const CODEX = { mode: 'rpc' as const, canPause: true, persistent: true, resume: 'rpc' as const };
  const CLAUDE = { mode: 'slash' as const, canPause: false, persistent: false, clearCommand: '/goal clear', resume: 'next-turn' as const };

  function nativeBanner() {
    const mount = createMockEl();
    const onNativeTogglePause = jest.fn();
    const onTogglePause = jest.fn();
    const banner = new GoalBanner({ mountEl: mount as any, onClear: jest.fn(), onDone: jest.fn(), onTogglePause, onNativeTogglePause });
    banner.setGoal('Alle Tests grün', 'Codex');
    const root = mount.querySelector('.claudian-goal-banner')!;
    const pause = mount.querySelector('.claudian-goal-banner-action')!;
    const done = mount.querySelector('.claudian-goal-banner-action--done')!;
    return { banner, mount, root, pause, done, onNativeTogglePause, onTogglePause };
  }

  it('shows the provider\'s status, round and reason, and marks it native', () => {
    const { banner, mount, root } = nativeBanner();

    banner.setNative({ objective: 'Alle Tests grün', status: 'active', round: 2, lastReason: 'Test 4 rot' }, CODEX);

    expect(root.hasClass('is-native')).toBe(true);
    expect(root.getAttribute('data-tone')).toBe('live');
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Ziel aktiv · Runde 2');
    expect(mount.querySelector('.claudian-goal-banner-loop')?.textContent).toBe('nativ');
    const detail = mount.querySelector('.claudian-goal-banner-detail')!;
    expect(detail.textContent).toBe('Noch nicht erfüllt: Test 4 rot');
    expect(detail.hasClass('claudian-hidden')).toBe(false);
  });

  it('pauses a pausable provider goal through its own callback', () => {
    const { banner, pause, onNativeTogglePause, onTogglePause } = nativeBanner();
    banner.setNative({ objective: 'Alle Tests grün', status: 'active' }, CODEX);

    pause.click();

    expect(onNativeTogglePause).toHaveBeenCalledWith(true);
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('offers no pause or done where the provider decides alone', () => {
    const { banner, pause, done } = nativeBanner();

    banner.setNative({ objective: 'Alle Tests grün', status: 'active' }, CLAUDE);

    expect(pause.hasClass('claudian-hidden')).toBe(true);
    expect(done.hasClass('claudian-hidden')).toBe(true);
  });

  it('turns semantic when the goal settles', () => {
    const { banner, root, mount } = nativeBanner();

    banner.setNative({ objective: 'Alle Tests grün', status: 'complete' }, CODEX);

    expect(root.getAttribute('data-tone')).toBe('success');
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Ziel erreicht');
  });

  it('returns to Claudian\'s loop controls when the goal is no longer provider-owned', () => {
    const { banner, root, pause, done } = nativeBanner();
    banner.setNative({ objective: 'Alle Tests grün', status: 'active' }, CLAUDE);

    banner.setNative(null, null);

    expect(root.hasClass('is-native')).toBe(false);
    expect(pause.hasClass('claudian-hidden')).toBe(false);
    expect(done.hasClass('claudian-hidden')).toBe(false);
  });
});

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
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Goal pausiert');

    banner.setPaused(false);
    expect(root?.hasClass('is-paused')).toBe(false);
    expect(mount.querySelector('.claudian-goal-banner-label')?.textContent).toBe('Goal aktiv');
  });

  it('keeps the pause button label in sync for screen readers', () => {
    const { actions, banner } = createFullBanner();

    expect(actions[0].getAttribute('aria-label')).toBe('Goal-Loop pausieren');

    banner.setPaused(true);

    expect(actions[0].getAttribute('aria-label')).toBe('Goal-Loop fortsetzen');
    expect(actions[0].hasClass('is-paused')).toBe(true);
  });
});

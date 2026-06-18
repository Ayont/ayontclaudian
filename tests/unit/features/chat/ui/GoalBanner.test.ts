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

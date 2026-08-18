import { createMockEl } from '@test/helpers/mockElement';

import { createUpdateSession, offerUpdateItems, queueOne, startNextQueued } from '@/app/update/UpdateSession';
import { UpdateDock } from '@/features/chat/ui/UpdateDock';

const CLAUDE = {
  id: 'cli:claude',
  kind: 'cli' as const,
  displayName: 'Claude Code',
  currentVersion: '2.1.0',
  latestVersion: '2.2.0',
  command: 'npm install -g @anthropic-ai/claude-code@latest',
};

function mountDock(): {
  dock: UpdateDock;
  mount: ReturnType<typeof createMockEl>;
  onStartAll: jest.Mock;
  onStartOne: jest.Mock;
  onDismiss: jest.Mock;
} {
  const mount = createMockEl();
  const onStartAll = jest.fn();
  const onStartOne = jest.fn();
  const onDismiss = jest.fn();
  const dock = new UpdateDock({
    mountEl: mount as unknown as HTMLElement,
    onStartAll,
    onStartOne,
    onDismiss,
  });
  return { dock, mount, onStartAll, onStartOne, onDismiss };
}

describe('UpdateDock', () => {
  it('stays hidden until updates are offered', () => {
    const { dock, mount } = mountDock();
    dock.setState(createUpdateSession());
    const root = mount.querySelector('.claudian-update-dock');
    expect(root).not.toBeNull();
    expect(root?.hasClass('claudian-hidden')).toBe(true);
  });

  it('shows available CLI updates with versions and a live update action', () => {
    const { dock, mount, onStartAll, onStartOne } = mountDock();
    dock.setState(offerUpdateItems(createUpdateSession(), [CLAUDE]));

    const root = mount.querySelector('.claudian-update-dock');
    expect(root?.hasClass('claudian-hidden')).toBe(false);
    expect(mount.querySelector('.claudian-update-dock-title')?.textContent).toContain('Update');
    expect(mount.querySelector('.claudian-update-item-name')?.textContent).toBe('Claude Code');
    expect(mount.querySelector('.claudian-update-item-versions')?.textContent).toContain('2.1.0');
    expect(mount.querySelector('.claudian-update-item-versions')?.textContent).toContain('2.2.0');

    mount.querySelector('.claudian-update-item-start')?.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
    expect(onStartOne).toHaveBeenCalledWith('cli:claude');

    mount.querySelector('.claudian-update-dock-start-all')?.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
    expect(onStartAll).toHaveBeenCalledTimes(1);
  });

  it('streams the installer log while a CLI update is running', () => {
    const { dock, mount } = mountDock();
    let session = offerUpdateItems(createUpdateSession(), [CLAUDE]);
    session = queueOne(session, CLAUDE.id);
    session = startNextQueued(session);
    session = {
      ...session,
      items: session.items.map((item) =>
        item.id === CLAUDE.id
          ? { ...item, percent: 37, logLines: ['npm notice', 'added 4 packages'] }
          : item,
      ),
    };
    dock.setState(session);

    expect(mount.querySelector('.claudian-update-item-log')?.textContent).toContain('added 4 packages');
    expect(mount.querySelector('.claudian-update-item-percent')?.textContent).toBe('37%');
    expect(mount.querySelector('.claudian-update-dock-start-all')).toBeNull();
  });

  it('dismisses an available item from the dock', () => {
    const { dock, mount, onDismiss } = mountDock();
    dock.setState(offerUpdateItems(createUpdateSession(), [CLAUDE]));
    mount.querySelector('.claudian-update-item-dismiss')?.dispatchEvent({
      type: 'click',
      stopPropagation: () => {},
    });
    expect(onDismiss).toHaveBeenCalledWith('cli:claude');
  });
});

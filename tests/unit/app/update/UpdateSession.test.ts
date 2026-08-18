import {
  applyItemProgress,
  completeItem,
  createUpdateSession,
  describeUpdateHeadline,
  dismissAllIdle,
  dismissItem,
  offerUpdateItems,
  queueAllAvailable,
  queueOne,
  startNextQueued,
  visibleItems,
} from '@/app/update/UpdateSession';

const CLAUDE = {
  id: 'cli:claude',
  kind: 'cli' as const,
  displayName: 'Claude Code',
  currentVersion: '2.1.0',
  latestVersion: '2.2.0',
  command: 'npm install -g @anthropic-ai/claude-code@latest',
};

const PLUGIN = {
  id: 'plugin',
  kind: 'plugin' as const,
  displayName: 'ayontclaudian',
  currentVersion: '5.99.2',
  latestVersion: '5.99.3',
};

describe('UpdateSession', () => {
  it('starts empty and stays hidden', () => {
    const session = createUpdateSession();
    expect(visibleItems(session)).toEqual([]);
    expect(describeUpdateHeadline(session)).toBe('');
  });

  it('offers plugin and CLI updates without starting them', () => {
    const session = offerUpdateItems(createUpdateSession(), [PLUGIN, CLAUDE]);
    const items = visibleItems(session);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.status)).toEqual(['available', 'available']);
    expect(describeUpdateHeadline(session)).toBe('2 Updates bereit');
  });

  it('does not duplicate an already-offered item', () => {
    const first = offerUpdateItems(createUpdateSession(), [CLAUDE]);
    const second = offerUpdateItems(first, [CLAUDE]);
    expect(visibleItems(second)).toHaveLength(1);
  });

  it('queues CLI updates before the plugin so a reload cannot abort them', () => {
    const offered = offerUpdateItems(createUpdateSession(), [PLUGIN, CLAUDE]);
    const queued = queueAllAvailable(offered);
    const running = startNextQueued(queued);
    expect(running.items.find((item) => item.id === CLAUDE.id)?.status).toBe('running');
    expect(running.items.find((item) => item.id === PLUGIN.id)?.status).toBe('queued');
    expect(describeUpdateHeadline(running)).toBe('Aktualisiere Claude Code…');
  });

  it('streams live installer lines onto the running item', () => {
    let session = offerUpdateItems(createUpdateSession(), [CLAUDE]);
    session = queueOne(session, CLAUDE.id);
    session = startNextQueued(session);
    session = applyItemProgress(session, CLAUDE.id, {
      phase: 'running',
      percent: 42,
      line: 'added 12 packages in 3s',
    });
    const item = session.items[0];
    expect(item.percent).toBe(42);
    expect(item.logLines).toEqual(['added 12 packages in 3s']);
    expect(item.status).toBe('running');
  });

  it('advances to the plugin after CLI updates finish', () => {
    let session = offerUpdateItems(createUpdateSession(), [PLUGIN, CLAUDE]);
    session = queueAllAvailable(session);
    session = startNextQueued(session);
    session = completeItem(session, CLAUDE.id, true);
    session = startNextQueued(session);
    expect(session.items.find((item) => item.id === CLAUDE.id)?.status).toBe('done');
    expect(session.items.find((item) => item.id === PLUGIN.id)?.status).toBe('running');
    expect(describeUpdateHeadline(session)).toBe('Aktualisiere ayontclaudian…');
  });

  it('records a failed install without dropping the log', () => {
    let session = offerUpdateItems(createUpdateSession(), [CLAUDE]);
    session = queueOne(session, CLAUDE.id);
    session = startNextQueued(session);
    session = applyItemProgress(session, CLAUDE.id, {
      phase: 'running',
      percent: null,
      line: 'npm ERR! network',
    });
    session = completeItem(session, CLAUDE.id, false, 'Installation fehlgeschlagen (Code 1).');
    expect(session.items[0].status).toBe('error');
    expect(session.items[0].error).toContain('fehlgeschlagen');
    expect(session.items[0].logLines).toContain('npm ERR! network');
  });

  it('dismisses idle items and keeps a running one', () => {
    let session = offerUpdateItems(createUpdateSession(), [PLUGIN, CLAUDE]);
    session = queueOne(session, CLAUDE.id);
    session = startNextQueued(session);
    session = dismissAllIdle(session);
    expect(visibleItems(session).map((item) => item.id)).toEqual([CLAUDE.id]);
    session = dismissItem(session, CLAUDE.id);
    expect(visibleItems(session)).toHaveLength(1);
    expect(session.items[1].status).toBe('running');
  });
});

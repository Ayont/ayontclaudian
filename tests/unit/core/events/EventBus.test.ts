import { EventBus } from '../../../../src/core/events/EventBus';

describe('EventBus', () => {
  it('delivers events to subscribers', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.on('vault:file-created', handler);
    bus.emit('vault:file-created', { path: 'note.md' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'vault:file-created',
      payload: { path: 'note.md' },
    }));
  });

  it('unsubscribes correctly', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubscribe = bus.on('vault:file-modified', handler);
    unsubscribe();
    bus.emit('vault:file-modified', { path: 'note.md' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles once subscriptions', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.once('vault:file-deleted', handler);
    bus.emit('vault:file-deleted', { path: 'note.md' });
    bus.emit('vault:file-deleted', { path: 'note.md' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('waits for async handlers', async () => {
    const bus = new EventBus();
    let called = false;
    bus.on('agent:run-completed', async () => {
      await new Promise(resolve => window.setTimeout(resolve, 10));
      called = true;
    });
    await bus.emitAndWait('agent:run-completed', { runId: '1' });
    expect(called).toBe(true);
  });

  it('isolates event types', () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.on('vault:file-created', handler);
    bus.emit('vault:file-modified', { path: 'note.md' });
    expect(handler).not.toHaveBeenCalled();
  });
});

export type ClaudianEventType =
  | 'vault:file-created'
  | 'vault:file-modified'
  | 'vault:file-deleted'
  | 'vault:file-renamed'
  | 'vault:daily'
  | 'memory:updated'
  | 'project:switched'
  | 'workflow:trigger'
  | 'agent:run-started'
  | 'agent:run-completed'
  | 'agent:run-error';

export interface ClaudianEvent<T = unknown> {
  type: ClaudianEventType;
  payload: T;
  timestamp: number;
}

export type ClaudianEventHandler<T = unknown> = (event: ClaudianEvent<T>) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<ClaudianEventType, Set<ClaudianEventHandler>>();

  on<T>(type: ClaudianEventType, handler: ClaudianEventHandler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set<ClaudianEventHandler>();
    set.add(handler as ClaudianEventHandler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler as ClaudianEventHandler);
    };
  }

  once<T>(type: ClaudianEventType, handler: ClaudianEventHandler<T>): void {
    const unsubscribe = this.on<T>(type, async (event) => {
      unsubscribe();
      await handler(event);
    });
  }

  emit<T>(type: ClaudianEventType, payload: T): void {
    const event: ClaudianEvent<T> = { type, payload, timestamp: Date.now() };
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        void handler(event);
      } catch {
        // Handlers must not crash the bus.
      }
    }
  }

  async emitAndWait<T>(type: ClaudianEventType, payload: T): Promise<void> {
    const event: ClaudianEvent<T> = { type, payload, timestamp: Date.now() };
    const set = this.handlers.get(type);
    if (!set) return;
    await Promise.allSettled(Array.from(set).map(handler => handler(event)));
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const globalEventBus = new EventBus();

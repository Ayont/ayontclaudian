import { buildPersistedKimiState, getKimiState } from '@/providers/kimi/types';

describe('KimiProviderState', () => {
  describe('getKimiState', () => {
    it('extracts sessionId and goal from persisted state', () => {
      const state = getKimiState({ sessionId: 'session_123', goal: 'explain Python' });
      expect(state.sessionId).toBe('session_123');
      expect(state.goal).toBe('explain Python');
    });

    it('ignores empty/whitespace goal and sessionId', () => {
      const state = getKimiState({ sessionId: '   ', goal: '   ' });
      expect(state.sessionId).toBeUndefined();
      expect(state.goal).toBeUndefined();
    });

    it('extracts forkParentId', () => {
      const state = getKimiState({ sessionId: 's1', forkParentId: 's0' });
      expect(state.forkParentId).toBe('s0');
    });

    it('ignores empty forkParentId', () => {
      const state = getKimiState({ sessionId: 's1', forkParentId: '   ' });
      expect(state.forkParentId).toBeUndefined();
    });

    it('returns an empty state for malformed input', () => {
      expect(getKimiState(undefined)).toEqual({});
      expect(getKimiState(null as unknown as Record<string, unknown>)).toEqual({});
      expect(getKimiState([] as unknown as Record<string, unknown>)).toEqual({});
    });
  });

  describe('buildPersistedKimiState', () => {
    it('serializes sessionId and goal', () => {
      const persisted = buildPersistedKimiState({ sessionId: 'session_123', goal: 'explain Python' });
      expect(persisted).toEqual({ sessionId: 'session_123', goal: 'explain Python' });
    });

    it('returns undefined when no fields are present', () => {
      expect(buildPersistedKimiState({})).toBeUndefined();
    });

    it('omits undefined fields', () => {
      expect(buildPersistedKimiState({ goal: 'review code' })).toEqual({ goal: 'review code' });
    });

    it('serializes forkParentId', () => {
      const persisted = buildPersistedKimiState({ sessionId: 's1', forkParentId: 's0' });
      expect(persisted).toEqual({ sessionId: 's1', forkParentId: 's0' });
    });
  });
});

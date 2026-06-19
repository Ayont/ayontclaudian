import { clearErrorHistory, getErrorHistory } from '@/core/diagnostics/errorHistory';
import { ProviderErrorRecoveryService } from '@/core/diagnostics/errorRecovery';
import type { ProviderId } from '@/core/providers/types';

describe('ProviderErrorRecoveryService', () => {
  let service: ProviderErrorRecoveryService;

  beforeEach(() => {
    clearErrorHistory();
    service = new ProviderErrorRecoveryService();
  });

  it('records and retrieves an error', () => {
    const error = new Error('cli crashed');
    const state = service.recordError('claude' as ProviderId, error);
    expect(state.providerId).toBe('claude');
    expect(state.error).toBe(error);
    expect(state.cleared).toBe(false);

    const retrieved = service.getError('claude' as ProviderId);
    expect(retrieved).toBeTruthy();
    expect(retrieved?.classified.providerId).toBe('claude');
  });

  it('clears an active error', () => {
    service.recordError('claude' as ProviderId, new Error('boom'));
    service.clearError('claude' as ProviderId);
    expect(service.hasActiveError('claude' as ProviderId)).toBe(false);
    expect(service.getError('claude' as ProviderId)).toBeNull();
  });

  it('classifies retryable process-exit errors as recoverable', () => {
    service.recordError('claude' as ProviderId, new Error('exited with code 1'));
    expect(service.isRecoverable('claude' as ProviderId)).toBe(true);
  });

  it('classifies auth errors as non-recoverable', () => {
    service.recordError('claude' as ProviderId, new Error('invalid api key'));
    expect(service.isRecoverable('claude' as ProviderId)).toBe(false);
  });

  it('returns non-recoverable when no error is recorded', () => {
    expect(service.isRecoverable('claude' as ProviderId)).toBe(false);
  });

  it('notifies listeners when an error is recorded and cleared', () => {
    const changes: ProviderId[] = [];
    const off = service.onChange((providerId) => { changes.push(providerId); });

    service.recordError('claude' as ProviderId, new Error('x'));
    service.clearError('claude' as ProviderId);
    off();

    expect(changes).toEqual(['claude', 'claude']);
  });

  it('tracks restart attempts and disables rapid restart loops', () => {
    service.recordError('claude' as ProviderId, new Error('exited with code 1'));
    expect(service.canRestart('claude' as ProviderId, 0)).toBe(true);

    service.recordRestartAttempt('claude' as ProviderId, 0);
    service.recordRestartAttempt('claude' as ProviderId, 15_000);
    expect(service.canRestart('claude' as ProviderId, 30_000)).toBe(false);

    expect(service.canRestart('claude' as ProviderId, 60_000)).toBe(true);
  });

  it('clears restart history when error is cleared', () => {
    service.recordError('claude' as ProviderId, new Error('exited with code 1'));
    service.recordRestartAttempt('claude' as ProviderId, 0);
    service.clearError('claude' as ProviderId);
    service.recordError('claude' as ProviderId, new Error('exited with code 1'));
    expect(service.canRestart('claude' as ProviderId, 30_000)).toBe(true);
  });

  it('records errors in errorHistory', () => {
    service.recordError('claude' as ProviderId, new Error('historic'));
    expect(getErrorHistory().some((r) => r.message.includes('historic'))).toBe(true);
  });
});

/**
 * Claudian - Provider error recovery service
 *
 * Central coordinator for provider errors in the chat sidebar and dashboard.
 * Records one active error per provider, classifies it, tracks restart attempts,
 * and notifies listeners so the UI can render recovery actions.
 */

import {
  type ClassifiedError,
  classifyProviderError,
} from '../../features/chat/rendering/errorClassification';
import type { ProviderId } from '../providers/types';
import { recordProviderError } from './errorHistory';

export interface ProviderErrorState {
  providerId: ProviderId;
  error: Error;
  classified: ClassifiedError;
  timestamp: number;
  cleared: boolean;
}

const RAPID_RESTART_WINDOW_MS = 30_000;
const MAX_RAPID_RESTARTS = 2;

export class ProviderErrorRecoveryService {
  private errors = new Map<ProviderId, ProviderErrorState>();
  private restartAttempts = new Map<ProviderId, number[]>();
  private listeners = new Set<(providerId: ProviderId) => void>();

  recordError(providerId: ProviderId, error: Error): ProviderErrorState {
    const classified = classifyProviderError(error.message, providerId);
    const state: ProviderErrorState = {
      providerId,
      error,
      classified,
      timestamp: Date.now(),
      cleared: false,
    };
    this.errors.set(providerId, state);
    recordProviderError(providerId, error.message, state.timestamp);
    this.notify(providerId);
    return state;
  }

  clearError(providerId: ProviderId): void {
    this.errors.delete(providerId);
    this.restartAttempts.delete(providerId);
    this.notify(providerId);
  }

  getError(providerId: ProviderId): ProviderErrorState | null {
    return this.errors.get(providerId) ?? null;
  }

  hasActiveError(providerId: ProviderId): boolean {
    return this.errors.has(providerId);
  }

  isRecoverable(providerId: ProviderId): boolean {
    const state = this.errors.get(providerId);
    return state ? state.classified.retryable : false;
  }

  canRestart(providerId: ProviderId, now = Date.now()): boolean {
    if (!this.isRecoverable(providerId)) {
      return false;
    }
    const attempts = this.restartAttempts.get(providerId) ?? [];
    const recent = attempts.filter((ts) => now - ts <= RAPID_RESTART_WINDOW_MS);
    return recent.length < MAX_RAPID_RESTARTS;
  }

  recordRestartAttempt(providerId: ProviderId, timestamp = Date.now()): void {
    const attempts = this.restartAttempts.get(providerId) ?? [];
    attempts.push(timestamp);
    this.restartAttempts.set(providerId, attempts);
  }

  onChange(listener: (providerId: ProviderId) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(providerId: ProviderId): void {
    for (const listener of this.listeners) {
      try {
        listener(providerId);
      } catch {
        // Don't let a listener failure break error handling.
      }
    }
  }
}

/** Shared singleton for the plugin runtime. */
export const providerErrorRecoveryService = new ProviderErrorRecoveryService();

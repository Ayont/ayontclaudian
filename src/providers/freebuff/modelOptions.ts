import type { ProviderUIOption } from '../../core/providers/types';
import { DEFAULT_FREEBUFF_MODELS } from './types/models';

/** Model dropdown: the verified harness catalog, in default-first order. */
export function getFreebuffModelOptions(_settings: Record<string, unknown>): ProviderUIOption[] {
  return [...DEFAULT_FREEBUFF_MODELS];
}
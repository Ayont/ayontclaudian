import type { ChatRuntime } from './ChatRuntime';

type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * Every optional ChatRuntime method a wrapper must pass through. A wrapper
 * that builds a new object silently drops any method it does not copy
 * (CLAUDE.md trap 12). The type below fails to compile when ChatRuntime gains
 * an optional method that is missing here.
 */
export const OPTIONAL_RUNTIME_METHODS = [
  'steer',
  'softSteer',
  'getAuxiliaryModel',
  'loadSubagentToolCalls',
  'loadSubagentFinalResult',
  'canCancelSubagent',
  'cancelSubagent',
  'supportsNativeGoal',
  'pauseNativeGoal',
  'clearNativeGoal',
] as const satisfies ReadonlyArray<OptionalKeys<ChatRuntime>>;

type Unlisted = Exclude<OptionalKeys<ChatRuntime>, typeof OPTIONAL_RUNTIME_METHODS[number]>;
// Compile-time guard: `never` when every optional method is listed.
const everyOptionalMethodListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyOptionalMethodListed;

/**
 * Copies the base runtime's optional methods onto a wrapper, bound to the
 * base, so providers that rely on `this` keep working. Methods the base does
 * not implement stay absent: absence is how the chat detects a capability.
 */
export function forwardOptionalRuntimeMethods(base: ChatRuntime, wrapped: ChatRuntime): void {
  const target = wrapped as unknown as Record<string, unknown>;
  for (const name of OPTIONAL_RUNTIME_METHODS) {
    const method = base[name] as unknown;
    if (typeof method !== 'function') continue;
    target[name] = (...args: unknown[]) => (method as (...params: unknown[]) => unknown).apply(base, args);
  }
}

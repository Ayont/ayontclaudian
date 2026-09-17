/**
 * Oh My Pi needs no provider-owned session state: the ACP session id on the
 * conversation is enough to find its transcript on disk (the filename ends with
 * it). Kept as an explicit empty shape so the runtime's `buildSessionUpdates`
 * contract stays typed rather than untyped `{}`.
 */
export type OmpProviderState = Record<string, never>;

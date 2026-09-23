import type { StreamChunk } from '../../../core/types';

/** SDKAPIRetryMessage (sdk.d.ts), reduced to what the status line reads. */
export interface ApiRetryMessage {
  type: 'system';
  subtype: 'api_retry';
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status: number | null;
  error: string;
  no_response?: { waited_ms: number; retry_wait_ms: number };
}

type NoticeChunk = Extract<StreamChunk, { type: 'notice' }>;

function isApiRetry(message: { type?: string; subtype?: string }): message is ApiRetryMessage {
  return message.type === 'system' && message.subtype === 'api_retry';
}

function describeCause(message: ApiRetryMessage): string {
  if (message.error === 'overloaded' || message.error_status === 529) return 'Anthropic-API überlastet';
  if (message.error === 'rate_limit' || message.error_status === 429) return 'Anthropic-Ratenlimit erreicht';
  if (message.no_response || message.error_status === null) return 'Anthropic-API antwortet nicht';
  return `Anthropic-API-Fehler ${message.error_status}`;
}

/**
 * The SDK retries overloaded or failing requests on its own and says so with
 * `api_retry`. Ignoring it left a turn looking frozen for up to a minute; a
 * transient notice explains the wait without writing into the answer.
 */
export function describeApiRetry(message: { type?: string; subtype?: string }): NoticeChunk | null {
  if (!isApiRetry(message)) return null;
  const seconds = Math.max(1, Math.ceil(message.retry_delay_ms / 1000));
  return {
    type: 'notice',
    level: 'info',
    transient: true,
    content: `${describeCause(message)} – neuer Versuch ${message.attempt}/${message.max_retries} in ${seconds} s`,
  };
}

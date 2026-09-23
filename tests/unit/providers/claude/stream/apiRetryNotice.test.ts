import { type ApiRetryMessage, describeApiRetry } from '@/providers/claude/stream/apiRetryNotice';

// Field names follow SDKAPIRetryMessage in sdk.d.ts.
const retry = (fields: Partial<ApiRetryMessage>): ApiRetryMessage => ({
  type: 'system',
  subtype: 'api_retry',
  attempt: 1,
  max_retries: 10,
  retry_delay_ms: 1000,
  error_status: 529,
  error: 'overloaded',
  ...fields,
});

describe('describeApiRetry', () => {
  it('names an overloaded API with attempt counter and rounded-up delay', () => {
    expect(describeApiRetry(retry({ attempt: 3, retry_delay_ms: 7200 }))?.content)
      .toBe('Anthropic-API überlastet – neuer Versuch 3/10 in 8 s');
  });

  it('names a rate limit separately from an overload', () => {
    expect(describeApiRetry(retry({ error: 'rate_limit', error_status: 429 }))?.content)
      .toBe('Anthropic-Ratenlimit erreicht – neuer Versuch 1/10 in 1 s');
  });

  it('names a connection problem when there was no HTTP response', () => {
    expect(describeApiRetry(retry({ error: 'unknown', error_status: null, no_response: { waited_ms: 30000, retry_wait_ms: 60000 } }))?.content)
      .toBe('Anthropic-API antwortet nicht – neuer Versuch 1/10 in 1 s');
  });

  it('falls back to the HTTP status for other server errors', () => {
    expect(describeApiRetry(retry({ error: 'server_error', error_status: 500, retry_delay_ms: 200 }))?.content)
      .toBe('Anthropic-API-Fehler 500 – neuer Versuch 1/10 in 1 s');
  });

  it('marks the notice transient so it never lands in the answer', () => {
    expect(describeApiRetry(retry({}))).toEqual(expect.objectContaining({ type: 'notice', level: 'info', transient: true }));
  });

  it('ignores other system messages', () => {
    expect(describeApiRetry({ type: 'system', subtype: 'init' })).toBeNull();
  });
});

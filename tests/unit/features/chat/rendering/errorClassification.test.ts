import {
  BLOCKED_MARKER,
  classifyProviderError,
  detectStatusCard,
  ERROR_MARKER,
  NOTICE_MARKER,
} from '@/features/chat/rendering/errorClassification';
import { setLocale } from '@/i18n/i18n';

describe('classifyProviderError', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('classifies HTTP 429 as a retryable limit warning', () => {
    const c = classifyProviderError('kimi-cli exited with code 75\n\nHTTP 429 rate_limit_reached_error', 'kimi');
    expect(c.severity).toBe('warning');
    expect(c.isLimit).toBe(true);
    expect(c.retryable).toBe(true);
    expect(c.title).toBe('Limit reached');
    expect(c.providerId).toBe('kimi');
  });

  it('classifies bare "exited with code 75" as a limit, not a process crash', () => {
    const c = classifyProviderError('kimi-cli exited with code 75', 'kimi');
    expect(c.isLimit).toBe(true);
    expect(c.severity).toBe('warning');
  });

  it('classifies invalid_request as a non-retryable error', () => {
    const c = classifyProviderError('invalid_request', 'grok');
    expect(c.severity).toBe('error');
    expect(c.isLimit).toBe(false);
    expect(c.retryable).toBe(false);
    expect(c.title).toBe('Invalid request');
  });

  it('classifies auth failures', () => {
    const c = classifyProviderError('HTTP 401 Unauthorized: invalid api key', 'vibe');
    expect(c.severity).toBe('error');
    expect(c.retryable).toBe(false);
    expect(c.title).toBe('Authentication failed');
  });

  it('classifies session/rollout errors as retryable warnings', () => {
    expect(classifyProviderError('no rollout found for thread id abc', 'codex').title).toBe('Session not found');
    const c = classifyProviderError('session not found', 'claude');
    expect(c.severity).toBe('warning');
    expect(c.retryable).toBe(true);
    expect(c.isLimit).toBe(false);
  });

  it('classifies network/timeout errors as retryable warnings', () => {
    const c = classifyProviderError('request timeout (ETIMEDOUT)', 'claude');
    expect(c.title).toBe('Network error');
    expect(c.severity).toBe('warning');
    expect(c.retryable).toBe(true);
  });

  it('classifies "could not find binary" as cliMissing BEFORE process-exit (non-retryable)', () => {
    const c = classifyProviderError('Could not find the `kimi-cli` binary. Set the CLI path in settings.', 'kimi');
    expect(c.title).toBe('CLI not found or disabled');
    expect(c.retryable).toBe(false);
  });

  it('classifies a generic exit code as a retryable process exit', () => {
    const c = classifyProviderError('kimi-cli exited with code 1', 'kimi');
    expect(c.title).toBe('CLI process exited');
    expect(c.retryable).toBe(true);
    expect(c.isLimit).toBe(false);
  });

  it('falls back to unknown for unrecognized content and preserves raw', () => {
    const c = classifyProviderError('  something totally unexpected happened  ', 'pi');
    expect(c.title).toBe('Unexpected error');
    expect(c.severity).toBe('error');
    expect(c.raw).toBe('something totally unexpected happened');
  });

  it('uses German strings under the de locale', () => {
    setLocale('de');
    expect(classifyProviderError('HTTP 429', 'kimi').title).toBe('Limit erreicht');
    expect(classifyProviderError('invalid_request', 'grok').title).toBe('Ungültige Anfrage');
    setLocale('en');
  });
});

describe('detectStatusCard', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('detects an error marker block and classifies it', () => {
    const c = detectStatusCard(`${ERROR_MARKER}invalid_request`);
    expect(c).not.toBeNull();
    expect(c?.title).toBe('Invalid request');
    expect(c?.raw).toBe('invalid_request');
  });

  it('detects a blocked notice as a warning card whose explanation is the raw text', () => {
    const c = detectStatusCard(`${BLOCKED_MARKER}Tool blocked by policy`);
    expect(c?.severity).toBe('warning');
    expect(c?.explanation).toBe('Tool blocked by policy');
    // raw === explanation → renderer will skip the duplicate disclosure.
    expect(c?.raw).toBe(c?.explanation);
  });

  it('detects a notice as an info card', () => {
    const c = detectStatusCard(`${NOTICE_MARKER}Heads up`);
    expect(c?.severity).toBe('info');
  });

  it('returns null for ordinary assistant text', () => {
    expect(detectStatusCard('Here is the answer to your question.')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(detectStatusCard(`\n\n${ERROR_MARKER}HTTP 429`)).not.toBeNull();
  });
});

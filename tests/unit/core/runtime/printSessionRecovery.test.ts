import {
  isStaleResumeFailure,
  looksLikeStaleSession,
} from '@/core/runtime/printSessionRecovery';

describe('looksLikeStaleSession', () => {
  it.each([
    'Error: session not found',
    'no rollout for this session',
    'conversation not found',
    'The session has expired',
    'session abc123 does not exist',
    'Unknown session id',
  ])('detects stale-session wording: %s', (text) => {
    expect(looksLikeStaleSession(text)).toBe(true);
  });

  it.each([
    '',
    'network timeout',
    'permission denied',
    'rate limit exceeded',
    'Error: model overloaded',
  ])('does not flag unrelated failures: %s', (text) => {
    expect(looksLikeStaleSession(text)).toBe(false);
  });
});

describe('isStaleResumeFailure', () => {
  it('flags a non-zero exit with stale-session stderr after a resume', () => {
    expect(
      isStaleResumeFailure({
        hadSession: true,
        exitCode: 1,
        stderr: 'session not found',
        producedOutput: false,
      }),
    ).toBe(true);
  });

  it('does not retry when no session was resumed (fresh start failure)', () => {
    expect(
      isStaleResumeFailure({
        hadSession: false,
        exitCode: 1,
        stderr: 'session not found',
        producedOutput: false,
      }),
    ).toBe(false);
  });

  it('does not retry once assistant output already streamed', () => {
    expect(
      isStaleResumeFailure({
        hadSession: true,
        exitCode: 1,
        stderr: 'session not found',
        producedOutput: true,
      }),
    ).toBe(false);
  });

  it('does not retry on a clean exit (code 0) or spawn error (null)', () => {
    expect(
      isStaleResumeFailure({ hadSession: true, exitCode: 0, stderr: 'session not found', producedOutput: false }),
    ).toBe(false);
    expect(
      isStaleResumeFailure({ hadSession: true, exitCode: null, stderr: 'session not found', producedOutput: false }),
    ).toBe(false);
  });

  it('does not retry when the failure is unrelated to the session', () => {
    expect(
      isStaleResumeFailure({ hadSession: true, exitCode: 75, stderr: 'rate limit', producedOutput: false }),
    ).toBe(false);
  });
});

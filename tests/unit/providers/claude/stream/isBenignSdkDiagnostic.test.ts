import { isBenignSdkDiagnostic } from '@/providers/claude/stream/transformClaudeMessage';

describe('isBenignSdkDiagnostic', () => {
  it('treats the reported bug case as benign (interrupt during a background task)', () => {
    expect(
      isBenignSdkDiagnostic(
        '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use(background task completed)',
      ),
    ).toBe(true);
  });

  it('treats a "turn aborted" diagnostic as benign regardless of stop_reason', () => {
    expect(isBenignSdkDiagnostic('[ede_diagnostic] turn aborted (interrupt) stop_reason=refusal')).toBe(true);
  });

  it('treats known-benign stop reasons as benign', () => {
    for (const reason of ['tool_use', 'end_turn', 'pause_turn', 'stop_sequence']) {
      expect(isBenignSdkDiagnostic(`[ede_diagnostic] stop_reason=${reason}`)).toBe(true);
    }
  });

  it('treats an absent/null stop reason as benign (the CLI itself could not explain it)', () => {
    expect(isBenignSdkDiagnostic('[ede_diagnostic] result_type=result last_content_type=n/a stop_reason=null')).toBe(
      true,
    );
    expect(isBenignSdkDiagnostic('[ede_diagnostic] result_type=result last_content_type=n/a')).toBe(true);
  });

  it('does NOT suppress a genuinely fatal-looking stop reason', () => {
    expect(isBenignSdkDiagnostic('[ede_diagnostic] result_type=user stop_reason=max_tokens')).toBe(false);
    expect(isBenignSdkDiagnostic('[ede_diagnostic] result_type=user stop_reason=refusal')).toBe(false);
  });

  it('ignores plain errors that do not carry the diagnostic tag', () => {
    expect(isBenignSdkDiagnostic('ENOENT: no such file or directory')).toBe(false);
    expect(isBenignSdkDiagnostic('')).toBe(false);
  });
});

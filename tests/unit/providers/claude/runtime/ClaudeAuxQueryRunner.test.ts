import type { AuxQueryConfig } from '@/core/auxiliary/AuxQueryRunner';
import { ClaudeAuxQueryRunner } from '@/providers/claude/runtime/ClaudeAuxQueryRunner';
import { runColdStartQuery } from '@/providers/claude/runtime/claudeColdStartQuery';

jest.mock('@/providers/claude/runtime/claudeColdStartQuery', () => ({
  runColdStartQuery: jest.fn(),
}));

const runColdStartQueryMock = jest.mocked(runColdStartQuery);

function createConfig(overrides: Partial<AuxQueryConfig> = {}): AuxQueryConfig {
  return {
    systemPrompt: 'Prüfe, ob das Ziel vollständig erreicht wurde.',
    model: 'claude-sonnet-4-5',
    ...overrides,
  };
}

describe('ClaudeAuxQueryRunner', () => {
  beforeEach(() => {
    runColdStartQueryMock.mockReset();
  });

  it('runs a stateless tool-free cold-start query and forwards streaming and usage', async () => {
    const onTextChunk = jest.fn();
    const onUsage = jest.fn();
    const usage = {
      inputTokens: 12,
      outputTokens: 4,
      contextWindow: 200_000,
      contextTokens: 16,
      percentage: 0.008,
      reportType: 'final' as const,
    };
    runColdStartQueryMock.mockImplementation(async (config) => {
      config.onTextChunk?.('Ziel ist erfüllt.');
      return { text: 'Ziel ist erfüllt.', sessionId: 'must-not-persist', usage };
    });
    const plugin = { app: {} } as never;
    const runner = new ClaudeAuxQueryRunner(plugin);

    await expect(runner.query(createConfig({ onTextChunk, onUsage }), 'Verifiziere das Ziel.'))
      .resolves.toBe('Ziel ist erfüllt.');

    expect(runColdStartQueryMock).toHaveBeenCalledWith({
      plugin,
      systemPrompt: 'Prüfe, ob das Ziel vollständig erreicht wurde.',
      model: 'claude-sonnet-4-5',
      abortController: expect.any(AbortController),
      onTextChunk,
      tools: [],
      thinking: { disabled: true },
      persistSession: false,
    }, 'Verifiziere das Ziel.');
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it('reset aborts the active cold-start query without persisting a session', async () => {
    let observedController: AbortController | undefined;
    runColdStartQueryMock.mockImplementation((config) => {
      observedController = config.abortController;
      return new Promise((_resolve, reject) => {
        config.abortController?.signal.addEventListener('abort', () => reject(new Error('Cancelled')));
      });
    });
    const runner = new ClaudeAuxQueryRunner({ app: {} } as never);
    const query = runner.query(createConfig(), 'Verifiziere das Ziel.');

    runner.reset();

    expect(observedController?.signal.aborted).toBe(true);
    await expect(query).rejects.toThrow('Cancelled');
  });
});

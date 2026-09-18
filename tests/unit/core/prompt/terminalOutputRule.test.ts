import { buildSystemPrompt } from '@/core/prompt/mainAgent';

/**
 * Console transcripts pasted into an answer as prose lose everything that makes
 * them readable: column alignment collapses into proportional text, table rules
 * become horizontal lines, and addresses turn into links. The renderer defuses
 * the worst of that, but only a fenced block gives the output a monospace grid.
 */
describe('system prompt: terminal output', () => {
  const prompt = (): string => buildSystemPrompt({ vaultPath: '/vault', userName: 'Ayont' });

  it('tells the agent to fence console and PowerShell output', () => {
    const text = prompt().toLowerCase();

    expect(text).toContain('console');
    expect(text).toMatch(/fenced|code block/);
  });

  it('names the alignment problem it is solving, not just the syntax', () => {
    expect(prompt()).toMatch(/align|column/i);
  });
});

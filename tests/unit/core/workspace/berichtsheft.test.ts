import { detectBuiltInCommand } from '@/core/commands/builtInCommands';
import { buildBerichtsheftPrompt } from '@/core/workspace/berichtsheft';
import { getWorkspaceQuickPrompts } from '@/core/workspace/workspaceMode';

describe('buildBerichtsheftPrompt', () => {
  it('expands an incident snippet into IHK weekly-report Markdown instructions', () => {
    const prompt = buildBerichtsheftPrompt(
      'Outlook startet nicht; Firewall-Policy blockiert SMTP nach dem Update.',
    );

    expect(prompt).toContain('Kalenderwoche');
    expect(prompt).toContain('Betrieb');
    expect(prompt).toContain('Berufsschule');
    expect(prompt).toContain('Tätigkeiten');
    expect(prompt).toContain('Stunden');
    expect(prompt).toContain('Outlook startet nicht');
    expect(prompt).toContain('Firewall-Policy');
    expect(prompt).not.toMatch(/HUNARI|Hilden/);
  });

  it('still produces the weekly-report skeleton when the snippet is empty', () => {
    const prompt = buildBerichtsheftPrompt('');
    expect(prompt).toContain('Kalenderwoche');
    expect(prompt).toContain('Betrieb');
    expect(prompt).toContain('Berufsschule');
    expect(prompt).toContain('Tätigkeiten');
    expect(prompt).toContain('Stunden');
  });
});

describe('Berichtsheft chat entry', () => {
  it('is reachable as /berichtsheft and as the Work-mode starter', () => {
    const slash = detectBuiltInCommand('/berichtsheft Outlook geht nicht, Firewall down');
    expect(slash?.command.action).toBe('berichtsheft');
    expect(slash?.args).toBe('Outlook geht nicht, Firewall down');

    const alias = detectBuiltInCommand('/ausbildungsnachweis KW12 Mail-Störung');
    expect(alias?.command.action).toBe('berichtsheft');

    const starter = getWorkspaceQuickPrompts('work').find((quick) => quick.label === 'Berichtsheft');
    expect(starter?.prompt).toMatch(/Ausbildungsnachweis|Berichtsheft/);
    expect(starter?.prompt).toContain('Kalenderwoche');
    expect(starter?.prompt).not.toBe(buildBerichtsheftPrompt());
  });
});

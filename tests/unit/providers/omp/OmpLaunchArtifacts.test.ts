import { prepareOmpLaunchArtifacts } from '@/providers/omp/runtime/OmpLaunchArtifacts';

describe('prepareOmpLaunchArtifacts', () => {
  it('passes an explicit prompt through verbatim for --append-system-prompt', () => {
    const artifacts = prepareOmpLaunchArtifacts({
      systemPromptKey: 'key-1',
      systemPromptText: 'CLAUDIAN VAULT RULES',
    });

    expect(artifacts.systemPromptText).toBe('CLAUDIAN VAULT RULES');
    expect(artifacts.launchKey).toBe('key-1');
  });

  it('keys the launch on the prompt so a prompt change restarts the process', () => {
    const first = prepareOmpLaunchArtifacts({ systemPromptText: 'A' });
    const second = prepareOmpLaunchArtifacts({ systemPromptText: 'B' });

    expect(first.launchKey).not.toBe(second.launchKey);
  });

  it('writes no config file — omp takes its prompt on the command line', () => {
    const artifacts = prepareOmpLaunchArtifacts({ systemPromptText: 'A' });

    expect(artifacts).not.toHaveProperty('configPath');
    expect(artifacts).not.toHaveProperty('databasePath');
  });

  it('refuses to guess a prompt when neither text nor settings are given', () => {
    expect(() => prepareOmpLaunchArtifacts({})).toThrow(/requires settings/);
  });
});

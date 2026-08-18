import {
  normalizeClineAcpToolInput,
  normalizeClineAcpToolName,
} from '@/providers/cline/normalization/clineAcpToolNormalization';
import {
  TOOL_BASH,
  TOOL_READ,
  TOOL_WRITE,
} from '@/core/tools/toolNames';

describe('normalizeClineAcpToolName', () => {
  it('maps Cline 3.x snake_case tools onto the shared renderer names', () => {
    expect(normalizeClineAcpToolName('read_files')).toBe(TOOL_READ);
    expect(normalizeClineAcpToolName('run_commands')).toBe(TOOL_BASH);
    expect(normalizeClineAcpToolName('editor')).toBe(TOOL_WRITE);
    expect(normalizeClineAcpToolName('submit_and_exit')).toBe('Ergebnis');
  });
});

describe('normalizeClineAcpToolInput', () => {
  it('lifts Cline read_files / run_commands / editor payloads into renderer fields', () => {
    expect(normalizeClineAcpToolInput('read_files', {
      files: [{ path: '/vault/Home.md' }, { path: '/vault/b.md' }],
    })).toEqual(expect.objectContaining({ file_path: '/vault/Home.md' }));

    expect(normalizeClineAcpToolInput('run_commands', {
      commands: ['whois certuss.ie', 'echo hi'],
    })).toEqual(expect.objectContaining({ command: 'whois certuss.ie' }));

    expect(normalizeClineAcpToolInput('editor', {
      path: '/vault/note.md',
      new_text: '# Hello',
    })).toEqual(expect.objectContaining({
      file_path: '/vault/note.md',
      contents: '# Hello',
    }));
  });

  it('keeps submit_and_exit summary for the completion card', () => {
    expect(normalizeClineAcpToolInput('submit_and_exit', {
      summary: 'Auth-Code kommt vom Registrar.',
      verified: true,
    })).toEqual(expect.objectContaining({
      summary: 'Auth-Code kommt vom Registrar.',
      verified: true,
    }));
  });
});

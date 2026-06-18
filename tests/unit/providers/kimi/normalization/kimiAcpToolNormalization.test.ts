import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_WRITE,
} from '@/core/tools/toolNames';
import {
  createKimiAcpToolStreamAdapter,
  normalizeKimiAcpToolInput,
  normalizeKimiAcpToolName,
} from '@/providers/kimi/normalization/kimiAcpToolNormalization';

describe('Kimi ACP tool normalization', () => {
  it.each([
    ['Read', TOOL_READ],
    ['View', TOOL_READ],
    ['Write', TOOL_WRITE],
    ['Edit', TOOL_EDIT],
    ['MultiEdit', TOOL_EDIT],
    ['Shell', TOOL_BASH],
    ['Bash', TOOL_BASH],
    ['Glob', TOOL_GLOB],
    ['LS', TOOL_GLOB],
    ['Grep', TOOL_GREP],
    ['unknown_tool', 'Unknown tool'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeKimiAcpToolName(raw)).toBe(expected);
  });

  it('maps path input to file_path for file tools', () => {
    const input = { path: '/tmp/file.ts' };
    const result = normalizeKimiAcpToolInput('Read', input);
    expect(result).toEqual({ file_path: '/tmp/file.ts' });
  });

  it('keeps non-file tool input unchanged', () => {
    const input = { command: 'ls' };
    const result = normalizeKimiAcpToolInput('Bash', input);
    expect(result).toEqual({ command: 'ls' });
  });

  it('creates an adapter instance', () => {
    const adapter = createKimiAcpToolStreamAdapter();
    expect(adapter).toBeDefined();
  });
});

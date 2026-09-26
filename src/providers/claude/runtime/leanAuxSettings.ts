/**
 * Options for Claude calls that need no tools (titles, commit messages, the
 * goal verifier). Loading the user's settings brings hooks, plugins, MCP
 * servers, skills and memory into every such call: measured on a real setup,
 * a title cost 118k cache-write tokens (0.24 $) that way and 454 tokens
 * (0.001 $) without them.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

type LeanOptions = Pick<Options, 'settingSources' | 'strictMcpConfig' | 'mcpServers' | 'extraArgs'> & {
  /** From the user's settings.json; the CLI would have applied it too. */
  env: Record<string, string>;
};

function readSettings(configDir: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function claudeConfigDir(env: Record<string, string | undefined>): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function leanAuxOptions(configDir: string): LeanOptions {
  const settings = readSettings(configDir);
  const env: Record<string, string> = {};
  if (settings.env && typeof settings.env === 'object') {
    for (const [key, value] of Object.entries(settings.env as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') env[key] = String(value);
    }
  }
  const base = { strictMcpConfig: true, mcpServers: {}, env };
  // A key helper lives in the settings and cannot be passed on; keep them, minus hooks.
  if (typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper) {
    return { ...base, settingSources: ['user'], extraArgs: { 'disable-slash-commands': null, settings: JSON.stringify({ disableAllHooks: true }) } };
  }
  return { ...base, settingSources: [], extraArgs: { 'disable-slash-commands': null } };
}

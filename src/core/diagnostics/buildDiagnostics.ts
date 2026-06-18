/**
 * Claudian - Diagnostics builder
 *
 * Renders a copy-paste-friendly Markdown snapshot of the plugin's runtime state:
 * version, key settings, per-provider availability, and the active conversation's
 * per-provider session map. Pure: takes a structured input, returns a string.
 * Used by the "Copy diagnostics" command to shortcut log-based debugging.
 */

export interface DiagnosticsProviderStatus {
  id: string;
  name: string;
  enabled: boolean;
  cliResolved: boolean;
  cliPath?: string | null;
}

export interface DiagnosticsConversation {
  id?: string;
  providerId: string;
  sessionId: string | null;
  goal?: string | null;
  /** Per-provider stashed native session ids (Conversation.providerSessions). */
  providerSessionIds?: Record<string, string | null | undefined>;
}

export interface DiagnosticsErrorRecord {
  timestamp: number;
  providerId: string;
  message: string;
}

export interface DiagnosticsInput {
  pluginVersion: string;
  generatedAt: string;
  permissionMode: string;
  autoMode: boolean;
  providers: DiagnosticsProviderStatus[];
  activeConversation?: DiagnosticsConversation | null;
  recentErrors?: DiagnosticsErrorRecord[];
}

function yesNo(value: boolean): string {
  return value ? '✅' : '❌';
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function buildDiagnosticsMarkdown(input: DiagnosticsInput): string {
  const lines: string[] = [];

  lines.push('### Claudian diagnostics');
  lines.push('');
  lines.push(`- **Version:** ${input.pluginVersion}`);
  lines.push(`- **Generated:** ${input.generatedAt}`);
  lines.push(`- **Permission mode:** ${input.permissionMode}`);
  lines.push(`- **Auto mode:** ${yesNo(input.autoMode)}`);
  lines.push('');

  lines.push('#### Providers');
  lines.push('');
  lines.push('| Provider | Enabled | CLI |');
  lines.push('| --- | :---: | :---: |');
  for (const provider of input.providers) {
    lines.push(`| ${provider.name} | ${yesNo(provider.enabled)} | ${yesNo(provider.cliResolved)} |`);
  }
  lines.push('');

  const conversation = input.activeConversation;
  if (conversation) {
    lines.push('#### Active conversation');
    lines.push('');
    lines.push(`- **Active provider:** ${conversation.providerId}`);
    lines.push(`- **Session id:** ${conversation.sessionId ? `\`${truncate(conversation.sessionId)}\`` : '—'}`);
    lines.push(`- **Goal:** ${conversation.goal ? truncate(conversation.goal, 120) : '—'}`);

    const sessionEntries = Object.entries(conversation.providerSessionIds ?? {});
    if (sessionEntries.length > 0) {
      lines.push('- **Per-provider sessions:**');
      for (const [providerId, sessionId] of sessionEntries) {
        lines.push(`  - ${providerId}: ${sessionId ? `\`${truncate(sessionId)}\`` : '—'}`);
      }
    }
    lines.push('');
  } else {
    lines.push('#### Active conversation');
    lines.push('');
    lines.push('- _No active conversation._');
    lines.push('');
  }

  const errors = input.recentErrors ?? [];
  lines.push('#### Recent errors');
  lines.push('');
  if (errors.length === 0) {
    lines.push('- _None recorded this session._');
  } else {
    for (const error of errors) {
      const time = new Date(error.timestamp).toISOString();
      lines.push(`- \`${time}\` **${error.providerId}** — ${error.message}`);
    }
  }
  lines.push('');

  return lines.join('\n').trimEnd();
}

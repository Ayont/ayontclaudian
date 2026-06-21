import type { ChatMessage, Conversation } from '../../../core/types/chat';

/**
 * Pure Markdown formatter for a chat conversation. No Obsidian imports so it is
 * fully unit-testable. The writer (ConversationExportWriter) handles vault IO.
 */

export interface ConversationExportOptions {
  /** Include the assistant's reasoning ("thinking") blocks. Default: false. */
  includeThinking?: boolean;
  /** Include a summary of tool calls per assistant turn. Default: true. */
  includeToolCalls?: boolean;
  /** Resolves a provider id to a human-readable name (e.g. "Claude"). */
  providerDisplayName?: (providerId: string) => string;
}

const ISO_FALLBACK = '';

function toIso(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return ISO_FALLBACK;
  try {
    return new Date(ts).toISOString();
  } catch {
    return ISO_FALLBACK;
  }
}

/** Escapes YAML-significant characters in a single-line front-matter value. */
function yamlString(value: string): string {
  const v = value.replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim();
  return `"${v}"`;
}

function resolveName(
  message: ChatMessage,
  conversation: Conversation,
  resolver?: (id: string) => string,
): string {
  if (message.agentLabel && message.agentLabel.trim()) return message.agentLabel.trim();
  const providerId = message.agentProvider ?? conversation.providerId;
  return resolver ? resolver(providerId) : providerId;
}

/** True for messages that should never appear in an export (internal/hidden). */
function isExportable(message: ChatMessage): boolean {
  if (message.isRebuiltContext) return false;
  const hasText = (message.content ?? '').trim().length > 0;
  const hasBlocks = (message.contentBlocks?.length ?? 0) > 0;
  const hasTools = (message.toolCalls?.length ?? 0) > 0;
  return hasText || hasBlocks || hasTools;
}

function uniqueModels(messages: ChatMessage[]): string[] {
  const models = new Set<string>();
  for (const m of messages) {
    if (m.agentModel && m.agentModel.trim()) models.add(m.agentModel.trim());
  }
  return Array.from(models);
}

/**
 * Renders a conversation to a Markdown note: YAML front-matter with provider
 * provenance, then one section per turn. Thinking and tool activity are
 * preserved as collapsible / summarized detail.
 */
export function formatConversationMarkdown(
  conversation: Conversation,
  opts: ConversationExportOptions = {},
): string {
  const includeThinking = opts.includeThinking ?? false;
  const includeToolCalls = opts.includeToolCalls ?? true;
  const resolver = opts.providerDisplayName;

  const messages = (conversation.messages ?? []).filter(isExportable);
  const providerName = resolver ? resolver(conversation.providerId) : conversation.providerId;
  const models = uniqueModels(conversation.messages ?? []);

  const lines: string[] = [];

  // Front-matter — provider provenance + metadata, machine-readable.
  lines.push('---');
  lines.push(`title: ${yamlString(conversation.title || 'Untitled conversation')}`);
  lines.push(`source: claudian`);
  lines.push(`provider: ${yamlString(providerName)}`);
  lines.push(`provider_id: ${yamlString(conversation.providerId)}`);
  if (models.length > 0) {
    lines.push(`models: [${models.map((m) => yamlString(m)).join(', ')}]`);
  }
  const created = toIso(conversation.createdAt);
  const updated = toIso(conversation.updatedAt ?? conversation.lastResponseAt);
  if (created) lines.push(`created: ${created}`);
  if (updated) lines.push(`updated: ${updated}`);
  lines.push(`message_count: ${messages.length}`);
  if (conversation.goal) lines.push(`goal: ${yamlString(conversation.goal)}`);
  lines.push('tags: [claudian, conversation]');
  lines.push('---');
  lines.push('');

  lines.push(`# ${conversation.title || 'Untitled conversation'}`);
  lines.push('');

  if (messages.length === 0) {
    lines.push('_This conversation has no messages yet._');
    lines.push('');
    return lines.join('\n');
  }

  for (const message of messages) {
    if (message.role === 'user') {
      lines.push('## You');
    } else {
      lines.push(`## ${resolveName(message, conversation, resolver)}`);
    }
    lines.push('');

    if (includeThinking) {
      const thinking = (message.contentBlocks ?? [])
        .filter((b): b is { type: 'thinking'; content: string; durationSeconds?: number } => b.type === 'thinking')
        .map((b) => b.content.trim())
        .filter(Boolean);
      for (const t of thinking) {
        lines.push('> [!note]- Reasoning');
        for (const tline of t.split('\n')) lines.push(`> ${tline}`);
        lines.push('');
      }
    }

    const body = (message.content ?? '').trim();
    if (body) {
      lines.push(body);
      lines.push('');
    }

    if (includeToolCalls && message.toolCalls && message.toolCalls.length > 0) {
      const names = message.toolCalls.map((t) => t.name).filter(Boolean);
      if (names.length > 0) {
        lines.push(`> [!abstract]- Tools used (${names.length})`);
        lines.push(`> ${names.join(', ')}`);
        lines.push('');
      }
    }

    if ((message.contentBlocks ?? []).some((b) => b.type === 'context_compacted')) {
      lines.push('> [!info] Context was compacted at this point.');
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** A filesystem-safe note name derived from the conversation title. */
export function safeExportFileName(title: string, fallback = 'conversation'): string {
  const base = (title || fallback)
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return base || fallback;
}

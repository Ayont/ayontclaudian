/**
 * Claudian - Context Utilities
 *
 * Current note and context file formatting for prompts.
 */

import { escapePromptXmlClosingTags } from './promptXml';

// Matches <current_note> at the START of prompt (legacy format)
const CURRENT_NOTE_PREFIX_REGEX = /^<current_note>\n[\s\S]*?<\/current_note>\n\n/;
// Matches <current_note> at the END of prompt (current format)
const CURRENT_NOTE_SUFFIX_REGEX = /\n\n<current_note>\n[\s\S]*?<\/current_note>$/;

/**
 * Pattern to match XML context tags appended to prompts.
 * These tags are always preceded by \n\n separator.
 * Matches: current_note, editor_selection (with attributes), editor_cursor (with attributes),
 * context_files, canvas_selection, browser_selection
 */
export const XML_CONTEXT_PATTERN = /\n\n<(?:vault_context|memory_context|graph_context|current_note|editor_selection|editor_cursor|context_files|canvas_selection|browser_selection|claudian_output_contract)[\s>]/;
const BRACKET_CONTEXT_PATTERN = /\n\[(?:Current note|Editor selection from|Browser selection from|Canvas selection from)\b/;
export const ATTACHED_FILE_PATTERN = /^Attached files?:\s*@?\S.*(?:\n|$)/gim;

// Codex persists image attachments as provider-internal XML before the human
// prompt. These tags are transport metadata, never user-authored chat text.
const INTERNAL_IMAGE_TAG_PATTERN = /<image\b(?=[^>]*\bname=\[Image\s+#\d+\])(?=[^>]*\bpath=(?:"[^"]*"|'[^']*'))[^>]*>(?:\s*<\/image>)?\s*/gi;

const SYSTEM_ENVELOPE_NAMES = 'standing_goal|claudian_output_contract|claudian_system_preamble|conversation_context|goal_loop_work_so_far|goal_loop|recommended_plugins|available_plugins|plugins_info|installed_plugins|environment_details';
const ALL_CONTEXT_NAMES = `${SYSTEM_ENVELOPE_NAMES}|vault_context|memory_context|graph_context`;

const VAULT_CONTEXT_PATTERN = new RegExp(
  `<vault_context>\\s*([\\s\\S]*?)(?:<\\/vault_context>|(?=<(?:\/?(?:${ALL_CONTEXT_NAMES}|current_note|editor_selection|context_files))\\b)|$)`,
  'i'
);
const MEMORY_CONTEXT_PATTERN = new RegExp(
  `<memory_context>\\s*([\\s\\S]*?)(?:<\\/memory_context>|(?=<(?:\/?(?:${ALL_CONTEXT_NAMES}|current_note|editor_selection|context_files))\\b)|$)`,
  'i'
);
const GRAPH_CONTEXT_PATTERN = new RegExp(
  `<graph_context>\\s*([\\s\\S]*?)(?:<\\/graph_context>|(?=<(?:\/?(?:${ALL_CONTEXT_NAMES}|current_note|editor_selection|context_files))\\b)|$)`,
  'i'
);

const INTERNAL_SYSTEM_ENVELOPE_PATTERN = new RegExp(
  `<(${SYSTEM_ENVELOPE_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1>\\s*|<(${SYSTEM_ENVELOPE_NAMES})\\b[^>]*>[\\s\\S]*?(?=<(?:\/?(?:${ALL_CONTEXT_NAMES}|current_note|editor_selection|context_files))\\b|$)\\s*`,
  'gi'
);
const ORPHANED_SYSTEM_CLOSING_PATTERN = new RegExp(
  `<\\/(?:${SYSTEM_ENVELOPE_NAMES})>\\s*`,
  'gi'
);
const TRUNCATED_MARKER_PATTERN = /<truncated\s+\d+\s+(?:bytes|chars|lines)>/gi;

const INJECTED_CONTEXT_PATTERN = new RegExp(
  `<(vault_context|memory_context|graph_context)>\\s*[\\s\\S]*?<\\/\\1>\\s*|<(vault_context|memory_context|graph_context)>\\s*[\\s\\S]*?(?=<(?:\/?(?:${ALL_CONTEXT_NAMES}|current_note|editor_selection|context_files))\\b|$)\\s*`,
  'gi'
);
const ORPHANED_INJECTED_CLOSING_PATTERN = /<\/(?:vault_context|memory_context|graph_context)>\s*/gi;

export function stripInternalImageTags(text: string): string {
  return text.replace(INTERNAL_IMAGE_TAG_PATTERN, '').trim();
}

export function stripInternalPromptEnvelopes(text: string): string {
  if (!text) return '';
  return text
    .replace(TRUNCATED_MARKER_PATTERN, '')
    .replace(INTERNAL_SYSTEM_ENVELOPE_PATTERN, '')
    .replace(ORPHANED_SYSTEM_CLOSING_PATTERN, '')
    .replace(ATTACHED_FILE_PATTERN, '')
    .trim();
}

export interface VaultContextPrompt {
  /** Markdown inside the machine-facing `<vault_context>` tag. */
  context: string;
  /** The actual human prompt, with trailing XML context removed when present. */
  userContent: string;
}

export interface InjectedContextPrompt {
  vaultContext?: string;
  memoryContext?: string;
  graphContext?: string;
  /** Human-authored prompt after all internal context envelopes are removed. */
  userContent: string;
}

export function formatCurrentNote(notePath: string): string {
  return `<current_note>\n${escapePromptXmlClosingTags(notePath, 'current_note')}\n</current_note>`;
}

export function appendCurrentNote(prompt: string, notePath: string): string {
  return `${prompt}\n\n${formatCurrentNote(notePath)}`;
}

/**
 * Strips current note context from a prompt (both prefix and suffix formats).
 * Handles legacy (prefix) and current (suffix) formats.
 */
export function stripCurrentNoteContext(prompt: string): string {
  // Try prefix format first (legacy)
  const strippedPrefix = prompt.replace(CURRENT_NOTE_PREFIX_REGEX, '');
  if (strippedPrefix !== prompt) {
    return strippedPrefix;
  }
  // Try suffix format (current)
  return prompt.replace(CURRENT_NOTE_SUFFIX_REGEX, '');
}

/**
 * Extracts user content that appears before XML context tags.
 * Handles two formats:
 * 1. Legacy: content inside <query> tags
 * 2. Current: user content first, context XML appended after
 */
export function extractContentBeforeXmlContext(text: string): string | undefined {
  if (!text) return undefined;

  // Legacy format: content inside <query> tags
  const queryMatch = text.match(/<query>\n?([\s\S]*?)\n?<\/query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }

  // Current format: user content before any XML context tags
  // Context tags are always appended with \n\n separator
  const xmlMatch = text.match(XML_CONTEXT_PATTERN);
  if (xmlMatch?.index !== undefined) {
    return text.substring(0, xmlMatch.index).trim();
  }

  return undefined;
}

/**
 * Separates the automatically injected vault context from a prompt that was
 * persisted by a provider-native transcript. RAG context is prepended to the
 * real user message, so the old "content before XML" rule cannot recover it.
 */
export function extractVaultContextPrompt(text: string): VaultContextPrompt | undefined {
  const injected = extractInjectedContextPrompt(text);
  if (!injected?.vaultContext) return undefined;

  return {
    context: injected.vaultContext,
    userContent: injected.userContent,
  };
}

/**
 * Removes every internal RAG/memory envelope regardless of whether a provider
 * persisted it before or after the human prompt. This is the canonical display
 * sanitizer for both live messages and rehydrated provider history.
 */
export function extractInjectedContextPrompt(text: string): InjectedContextPrompt | undefined {
  if (!text) return undefined;
  const sanitizedText = stripInternalPromptEnvelopes(text);
  const vaultMatch = sanitizedText.match(VAULT_CONTEXT_PATTERN);
  const memoryMatch = sanitizedText.match(MEMORY_CONTEXT_PATTERN);
  const graphMatch = sanitizedText.match(GRAPH_CONTEXT_PATTERN);
  if (!vaultMatch && !memoryMatch && !graphMatch) return undefined;

  const withoutInjectedContext = stripInternalImageTags(
    sanitizedText
      .replace(INJECTED_CONTEXT_PATTERN, '')
      .replace(ORPHANED_INJECTED_CLOSING_PATTERN, ''),
  );
  const userContent = (extractContentBeforeXmlContext(withoutInjectedContext)
    ?? withoutInjectedContext).replace(ATTACHED_FILE_PATTERN, '');

  return {
    ...(vaultMatch?.[1]?.trim() ? { vaultContext: vaultMatch[1].trim() } : {}),
    ...(memoryMatch?.[1]?.trim() ? { memoryContext: memoryMatch[1].trim() } : {}),
    ...(graphMatch?.[1]?.trim() ? { graphContext: graphMatch[1].trim() } : {}),
    userContent: userContent.trim(),
  };
}

export function extractUserDisplayContent(text: string): string | undefined {
  if (!text) return undefined;

  const withoutImageTags = stripInternalImageTags(text);
  const withoutInternalEnvelopes = stripInternalPromptEnvelopes(withoutImageTags);
  const removedInternalTransport = withoutInternalEnvelopes !== text.trim();

  const injectedContext = extractInjectedContextPrompt(withoutInternalEnvelopes);
  if (injectedContext) {
    return injectedContext.userContent;
  }

  const xmlDisplayContent = extractContentBeforeXmlContext(withoutInternalEnvelopes);
  if (xmlDisplayContent !== undefined) {
    return xmlDisplayContent.replace(ATTACHED_FILE_PATTERN, '').trim();
  }

  const bracketMatch = withoutInternalEnvelopes.match(BRACKET_CONTEXT_PATTERN);
  if (bracketMatch?.index !== undefined) {
    return withoutInternalEnvelopes.substring(0, bracketMatch.index).replace(ATTACHED_FILE_PATTERN, '').trim();
  }

  const cleaned = withoutInternalEnvelopes.replace(ATTACHED_FILE_PATTERN, '').trim();
  if (cleaned.length === 0 && (removedInternalTransport || text.includes('Attached file'))) {
    return '';
  }

  return removedInternalTransport ? cleaned : undefined;
}

/**
 * Extracts the actual user query from an XML-wrapped prompt.
 * Used for comparing prompts during history deduplication.
 *
 * Always returns a string - falls back to stripping all XML tags if no
 * structured context is found.
 */
export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';

  const sanitizedPrompt = stripInternalPromptEnvelopes(prompt);

  const injectedContext = extractInjectedContextPrompt(sanitizedPrompt);
  if (injectedContext) {
    return injectedContext.userContent;
  }

  // Try to extract content before XML context
  const extracted = extractContentBeforeXmlContext(sanitizedPrompt);
  if (extracted !== undefined) {
    return extracted.replace(ATTACHED_FILE_PATTERN, '').trim();
  }

  // No XML context - return the whole prompt stripped of any remaining tags
  return stripInternalImageTags(sanitizedPrompt)
    .replace(ATTACHED_FILE_PATTERN, '')
    .replace(/<current_note>[\s\S]*?<\/current_note>\s*/g, '')
    .replace(/<editor_selection[\s\S]*?<\/editor_selection>\s*/g, '')
    .replace(/<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g, '')
    .replace(/<context_files>[\s\S]*?<\/context_files>\s*/g, '')
    .replace(/<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g, '')
    .replace(/<browser_selection[\s\S]*?<\/browser_selection>\s*/g, '')
    .replace(/<vault_context>[\s\S]*?<\/vault_context>\s*/g, '')
    .replace(/<memory_context>[\s\S]*?<\/memory_context>\s*/g, '')
    .replace(/<graph_context>[\s\S]*?<\/graph_context>\s*/g, '')
    .trim();
}

function formatContextFilesLine(files: string[]): string {
  return `<context_files>\n${files.join(', ')}\n</context_files>`;
}

export function appendContextFiles(prompt: string, files: string[]): string {
  return `${prompt}\n\n${formatContextFilesLine(files)}`;
}

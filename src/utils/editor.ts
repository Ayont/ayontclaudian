/**
 * Claudian - Editor Context Utilities
 *
 * Editor cursor and selection context for inline editing.
 */

import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

import { escapePromptXmlAttribute, escapePromptXmlClosingTags } from './promptXml';

/**
 * Gets the CodeMirror EditorView from an Obsidian Editor.
 * Obsidian's Editor type doesn't expose the internal `.cm` property.
 */
export function getEditorView(editor: Editor): EditorView | undefined {
  return (editor as unknown as { cm?: EditorView }).cm;
}

export interface CursorContext {
  beforeCursor: string;
  afterCursor: string;
  isInbetween: boolean;
  line: number;
  column: number;
}

export interface EditorSelectionContext {
  notePath: string;
  mode: 'selection' | 'cursor' | 'none';
  selectedText?: string;
  cursorContext?: CursorContext;
  lineCount?: number; // Number of lines in selection (for UI indicator)
  startLine?: number; // 1-indexed starting line number
}

export function findNearestNonEmptyLine(
  getLine: (line: number) => string,
  lineCount: number,
  startLine: number,
  direction: 'before' | 'after'
): string {
  const step = direction === 'before' ? -1 : 1;
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i);
    if (content.trim().length > 0) {
      return content;
    }
  }
  return '';
}

/** All line/column params are 0-indexed. */
export function buildCursorContext(
  getLine: (line: number) => string,
  lineCount: number,
  line: number,
  column: number
): CursorContext {
  const lineContent = getLine(line);
  const beforeCursor = lineContent.substring(0, column);
  const afterCursor = lineContent.substring(column);

  const lineIsEmpty = lineContent.trim().length === 0;
  const nothingBefore = beforeCursor.trim().length === 0;
  const nothingAfter = afterCursor.trim().length === 0;
  const isInbetween = lineIsEmpty || (nothingBefore && nothingAfter);

  let contextBefore = beforeCursor;
  let contextAfter = afterCursor;

  if (isInbetween) {
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, 'before');
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, 'after');
  }

  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column };
}

export function formatEditorContext(context: EditorSelectionContext): string {
  if (context.mode === 'selection' && context.selectedText) {
    const lineAttr = context.startLine && context.lineCount
      ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"`
      : '';
    return `<editor_selection path="${escapePromptXmlAttribute(context.notePath)}"${lineAttr}>\n${escapePromptXmlClosingTags(context.selectedText, 'editor_selection')}\n</editor_selection>`;
  } else if (context.mode === 'cursor' && context.cursorContext) {
    const ctx = context.cursorContext;
    let content: string;
    if (ctx.isInbetween) {
      const parts = [];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push('| #inbetween');
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      content = parts.join('\n');
    } else {
      content = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
    }
    return `<editor_cursor path="${escapePromptXmlAttribute(context.notePath)}">\n${escapePromptXmlClosingTags(content, 'editor_cursor')}\n</editor_cursor>`;
  }
  return '';
}

export function appendEditorContext(prompt: string, context: EditorSelectionContext): string {
  const formatted = formatEditorContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}

const EDITOR_SELECTION_ENVELOPE = /<editor_selection path="([^"]*)"(?: lines="(\d+)-(\d+)")?>\n([\s\S]*?)\n<\/editor_selection>/;

function unescapePromptXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Reads back the selection a persisted prompt carried, so a resent turn asks
 * about the same text instead of whatever happens to be selected now.
 * Inverse of {@link formatEditorContext} for selections.
 */
export function parseEditorSelectionContext(prompt: string): EditorSelectionContext | null {
  const match = EDITOR_SELECTION_ENVELOPE.exec(prompt ?? '');
  if (!match) return null;
  const [, rawPath, firstLine, lastLine, body] = match;
  const selectedText = body.replace(/&lt;\/editor_selection&gt;/gi, '</editor_selection>');
  const startLine = firstLine ? Number(firstLine) : undefined;
  const lineCount = startLine !== undefined && lastLine
    ? Number(lastLine) - startLine + 1
    : selectedText.split(/\r?\n/).length;
  return {
    notePath: unescapePromptXmlAttribute(rawPath),
    mode: 'selection',
    selectedText,
    lineCount,
    ...(startLine !== undefined ? { startLine } : {}),
  };
}

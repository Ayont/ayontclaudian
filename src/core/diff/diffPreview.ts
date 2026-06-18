import { countLineChanges, diffFromToolInput, parseApplyPatchDiffs } from '../../utils/diff';
import { TOOL_APPLY_PATCH, TOOL_EDIT, TOOL_NOTEBOOK_EDIT, TOOL_WRITE } from '../tools/toolNames';
import type { ToolCallInfo, ToolDiffData } from '../types';
import type { DiffLine } from '../types/diff';

export interface DiffPreview {
  title: string;
  diffs: ToolDiffData[];
}

function getString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function buildNotebookDiff(input: Record<string, unknown>, filePath: string): ToolDiffData | null {
  const oldText = getString(input, ['old_string', 'oldText', 'old_text']);
  const newText = getString(input, ['new_string', 'newText', 'new_text', 'content']);
  if (!oldText && !newText) return null;
  const diffLines: DiffLine[] = [];
  for (const line of (oldText ?? '').split('\n')) diffLines.push({ type: 'delete', text: line });
  for (const line of (newText ?? '').split('\n')) diffLines.push({ type: 'insert', text: line });
  return { filePath, diffLines, stats: countLineChanges(diffLines) };
}

export function buildDiffPreview(toolName: string, input: Record<string, unknown>): DiffPreview | null {
  if (toolName === TOOL_APPLY_PATCH) {
    const patch = getString(input, ['patch', 'input', 'diff']);
    if (!patch) return null;
    const diffs = parseApplyPatchDiffs(patch);
    return diffs.length > 0 ? { title: 'Patch preview', diffs } : null;
  }

  if (![TOOL_WRITE, TOOL_EDIT, TOOL_NOTEBOOK_EDIT].includes(toolName as typeof TOOL_WRITE)) {
    return null;
  }

  const filePath = getString(input, ['file_path', 'path', 'notebook_path']) ?? 'file';
  if (toolName === TOOL_NOTEBOOK_EDIT) {
    const diff = buildNotebookDiff(input, filePath);
    return diff ? { title: 'Notebook edit preview', diffs: [diff] } : null;
  }

  const toolCall: ToolCallInfo = {
    id: 'preview',
    name: toolName,
    input,
    status: 'running',
  };
  const diff = diffFromToolInput(toolCall, filePath);
  return diff ? { title: `${toolName} preview`, diffs: [diff] } : null;
}

export function summarizeDiffPreview(preview: DiffPreview): string {
  return preview.diffs
    .map(diff => `${diff.filePath} (+${diff.stats.added}/-${diff.stats.removed})`)
    .join(', ');
}

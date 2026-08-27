import type { ContentBlock, OutputSurface } from '../../../core/types';

type RichOutputSurface = Exclude<OutputSurface, 'chat' | 'image'>;

interface RichFenceSpec {
  language: string;
  surface: RichOutputSurface;
}

export interface RichOutputInspection {
  surface: RichOutputSurface;
  language: string;
  start: number;
  end: number;
  closed: boolean;
}

export interface CompletedRichOutputSplit {
  semanticContent: string;
  remainder: string;
}

const RICH_FENCE_SPECS: readonly RichFenceSpec[] = [
  { language: 'claudian-document', surface: 'live-document' },
  { language: 'live-document', surface: 'live-document' },
  { language: 'claudian-email', surface: 'email' },
  { language: 'email-template', surface: 'email' },
  { language: 'network-map', surface: 'network-map' },
  { language: 'claudian-skill', surface: 'skill' },
];

const SPEC_BY_LANGUAGE = new Map(
  RICH_FENCE_SPECS.map((spec) => [spec.language, spec] as const),
);

function isRichOutputSurface(surface: OutputSurface | undefined): surface is RichOutputSurface {
  return surface !== undefined && surface !== 'chat' && surface !== 'image';
}

function scanRichOutputFences(markdown: string): RichOutputInspection[] {
  const inspections: RichOutputInspection[] = [];
  const opening = /(^|\n)(`{3,})([^\n`]*)\n/g;
  let match: RegExpExecArray | null;

  while ((match = opening.exec(markdown)) !== null) {
    const language = match[3].trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    const spec = SPEC_BY_LANGUAGE.get(language);
    if (!spec) continue;

    const start = match.index + match[1].length;
    const contentStart = opening.lastIndex;
    const fence = match[2];
    const closing = new RegExp(`(^|\\n)${fence}[ \\t]*(?=\\n|$)`, 'g');
    closing.lastIndex = contentStart;
    const closeMatch = closing.exec(markdown);
    const closed = closeMatch !== null;
    const end = closeMatch
      ? closeMatch.index + closeMatch[1].length + closeMatch[0].length - closeMatch[1].length
      : markdown.length;

    inspections.push({
      surface: spec.surface,
      language,
      start,
      end,
      closed,
    });

    if (!closed) break;
    opening.lastIndex = end;
  }

  return inspections;
}

/** Returns the first specialized fence, including unfinished streaming fences. */
export function inspectRichOutput(markdown: string): RichOutputInspection | null {
  return scanRichOutputFences(markdown)[0] ?? null;
}

/** Splits prose emitted after a completed rich artifact back into normal order. */
export function splitCompletedRichOutput(
  markdown: string,
  surface: OutputSurface,
): CompletedRichOutputSplit | null {
  const matching = scanRichOutputFences(markdown)
    .filter((inspection) => inspection.surface === surface);
  if (matching.length === 0) return null;

  // Progressive maps may contain several full snapshots. They are all part of
  // the same semantic artifact; prose begins only after the latest frame.
  const terminal = surface === 'network-map' ? matching[matching.length - 1] : matching[0];
  if (!terminal.closed) return null;
  return {
    semanticContent: markdown.slice(0, terminal.end),
    remainder: markdown.slice(terminal.end),
  };
}

/** Resolves an explicit fence first and otherwise the application-selected target. */
export function resolveRichOutputSurface(
  markdown: string,
  preferredSurface?: OutputSurface,
): RichOutputSurface | undefined {
  return inspectRichOutput(markdown)?.surface
    ?? (isRichOutputSurface(preferredSurface) ? preferredSurface : undefined);
}

/**
 * Whether a tool boundary is only interrupting, rather than ending, the
 * current rich output block.
 */
export function shouldContinueRichOutputAcrossTool(
  markdown: string,
  preferredSurface?: OutputSurface,
): boolean {
  const inspection = inspectRichOutput(markdown);
  if (inspection) {
    return !inspection.closed || inspection.surface === 'network-map';
  }

  // Providers occasionally ignore the requested fence. Explicit document and
  // email turns still form one surface across any tool calls in that turn.
  return preferredSurface === 'live-document' || preferredSurface === 'email';
}

function longestBacktickRun(markdown: string): number {
  let longest = 0;
  for (const match of markdown.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

/**
 * Turns unfenced provider output into the deterministic surface requested by
 * the application. Only document and email have safe plain-text fallbacks.
 */
export function prepareRichOutputMarkdown(
  markdown: string,
  surface?: OutputSurface,
): string {
  let prepared = markdown;
  if (!inspectRichOutput(markdown) && (surface === 'live-document' || surface === 'email')) {
    const language = surface === 'live-document' ? 'claudian-document' : 'claudian-email';
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(markdown) + 1));
    prepared = `${fence}${language}\n${markdown.trim()}\n${fence}`;
  }
  return canonicalizeNetworkMapFrames(prepared);
}

/** Keeps the newest complete/progressive topology instead of stacking drafts. */
export function canonicalizeNetworkMapFrames(markdown: string): string {
  const maps = scanRichOutputFences(markdown)
    .filter((inspection) => inspection.surface === 'network-map');
  if (maps.length <= 1) return markdown;

  const first = maps[0];
  const latest = maps[maps.length - 1];
  let tail = '';
  let cursor = first.end;
  for (const map of maps.slice(1)) {
    tail += markdown.slice(cursor, map.start);
    cursor = map.end;
  }
  tail += markdown.slice(cursor);

  return markdown.slice(0, first.start)
    + markdown.slice(latest.start, latest.end)
    + tail;
}

/**
 * Repairs transcripts produced before rich-output continuity was persisted:
 * an unfinished fence and its later text continuation become one text block,
 * while intervening tool blocks retain their relative position after it.
 */
export function coalesceRichOutputBlocks(
  blocks: readonly ContentBlock[],
  preferredSurface?: OutputSurface,
): ContentBlock[] {
  const result: ContentBlock[] = [];
  let active: Extract<ContentBlock, { type: 'text' }> | null = null;
  let activeIsImplicit = false;

  for (const sourceBlock of blocks) {
    if (sourceBlock.type !== 'text') {
      result.push({ ...sourceBlock });
      continue;
    }

    let sourceText = sourceBlock.content;
    if (active) {
      active.content += sourceBlock.content;
      const inspection = inspectRichOutput(active.content);
      const split = active.outputSurface
        ? splitCompletedRichOutput(active.content, active.outputSurface)
        : null;
      if (!activeIsImplicit && split?.remainder.trim()) {
        active.content = split.semanticContent;
        sourceText = split.remainder;
        active = null;
        activeIsImplicit = false;
      } else {
        if (!activeIsImplicit && inspection?.closed) active = null;
        continue;
      }
    }

    const block = { ...sourceBlock, content: sourceText };
    const inspection = inspectRichOutput(block.content);
    const surface = block.outputSurface
      ?? inspection?.surface
      ?? ((preferredSurface === 'live-document' || preferredSurface === 'email')
        ? preferredSurface
        : undefined);
    if (surface && surface !== 'chat' && surface !== 'image') {
      block.outputSurface = surface;
    }
    result.push(block);

    if (inspection && !inspection.closed) {
      active = block;
      activeIsImplicit = false;
    } else if (!inspection && (surface === 'live-document' || surface === 'email')) {
      active = block;
      activeIsImplicit = true;
    }
  }

  // Repeated map frames are progressive snapshots of one artifact. Anchor the
  // canonical block at the first frame so tool order remains stable.
  const mapBlocks = result.filter(
    (block): block is Extract<ContentBlock, { type: 'text' }> =>
      block.type === 'text' && block.outputSurface === 'network-map',
  );
  if (mapBlocks.length > 1) {
    const canonical = mapBlocks[0];
    canonical.content = mapBlocks.map((block) => block.content).join('\n\n');
    const obsolete = new Set(mapBlocks.slice(1));
    return result.filter((block) => !obsolete.has(block as Extract<ContentBlock, { type: 'text' }>));
  }

  return result;
}

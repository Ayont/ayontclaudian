import { setIcon } from 'obsidian';
import { getLocale } from '../../../i18n/i18n';

/**
 * Smoothly folds down an activity details group with an Apple spring animation.
 */
export function foldDownActivity(groupEl: HTMLDetailsElement): void {
  if (!groupEl.open) return;
  groupEl.classList.add('is-folding');
  const body = groupEl.querySelector<HTMLElement>('.claudian-activity-body, .claudian-tool-run-body');
  if (body && typeof body.animate === 'function') {
    const currentHeight = body.getBoundingClientRect().height || Math.min(body.scrollHeight || 200, 650);
    const anim = body.animate([
      { opacity: '1', maxHeight: `${currentHeight}px`, transform: 'translateY(0)' },
      { opacity: '0', maxHeight: '0px', transform: 'translateY(-6px)' }
    ], {
      duration: 250,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    });
    anim.onfinish = () => {
      groupEl.open = false;
      groupEl.classList.remove('is-folding');
    };
  } else {
    groupEl.open = false;
    groupEl.classList.remove('is-folding');
  }
}

/**
 * Smoothly unfolds an activity details group with an Apple spring animation.
 */
export function unfoldActivity(groupEl: HTMLDetailsElement): void {
  groupEl.open = true;
  groupEl.classList.remove('is-folding');
  const body = groupEl.querySelector<HTMLElement>('.claudian-activity-body, .claudian-tool-run-body');
  if (body && typeof body.animate === 'function') {
    const targetHeight = Math.min(body.scrollHeight || 380, 650);
    body.animate([
      { opacity: '0', maxHeight: '0px', transform: 'translateY(-6px)' },
      { opacity: '1', maxHeight: `${targetHeight}px`, transform: 'translateY(0)' }
    ], {
      duration: 280,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    });
  }
}

/**
 * Formats a raw tool name into a clean, human-friendly short tag.
 */
export function formatToolShortTag(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('find_by_name') || lower.includes('findbyname')) return 'find';
  if (lower.includes('grep_search') || lower.includes('grepsearch')) return 'grep';
  if (lower.includes('run_command') || lower.includes('bash') || lower === 'exec') return 'bash';
  if (lower.includes('list_dir') || lower.includes('listdir')) return 'ls';
  if (lower.includes('view_file') || lower.includes('read')) return 'read';
  if (lower.includes('edit_file') || lower.includes('edit')) return 'edit';
  if (lower.includes('create_file') || lower.includes('create') || lower.includes('write')) return 'write';
  if (lower.includes('search')) return 'search';
  return name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
}

/**
 * Builds localized activity fold title and breakdown labels.
 */
export function buildActivityLabels(
  totalSteps: number,
  toolsCount: number,
  thoughtsCount: number,
  distinctToolNames: readonly string[] = [],
  locale: string = getLocale(),
  isWorkMode: boolean = false
): { title: string; breakdown: string } {
  const isDe = locale === 'de';

  let title = '';
  if (isWorkMode) {
    if (totalSteps === 1 && toolsCount === 1) {
      title = isDe ? '1 Recherche-Aktion ausgeführt' : '1 research step completed';
    } else if (totalSteps === 1 && thoughtsCount === 1) {
      title = isDe ? '1 Analyse-Schritt' : '1 analysis step';
    } else {
      title = isDe ? `${totalSteps} Arbeitsschritte ausgeführt` : `${totalSteps} work steps completed`;
    }
  } else {
    if (totalSteps === 1 && toolsCount === 1) {
      title = isDe ? '1 Coding-Aktion ausgeführt' : '1 coding action completed';
    } else if (totalSteps === 1 && thoughtsCount === 1) {
      title = isDe ? '1 Architektur-Überlegung' : '1 architecture thought';
    } else {
      title = isDe ? `${totalSteps} Schritte ausgeführt` : `${totalSteps} steps completed`;
    }
  }

  const parts: string[] = [];
  const toolsLabel = isDe ? (isWorkMode ? 'Recherche-Tools' : 'Werkzeuge') : 'tools';
  const thoughtsLabel = isDe ? (isWorkMode ? 'Analysen' : 'Überlegungen') : 'thoughts';

  if (toolsCount > 0 && thoughtsCount > 0) {
    parts.push(isDe ? `${toolsCount} ${toolsLabel}` : `${toolsCount} tools`);
    parts.push(isDe ? `${thoughtsCount} ${thoughtsLabel}` : `${thoughtsCount} thoughts`);
  } else if (toolsCount > 1) {
    parts.push(isDe ? `${toolsCount} ${toolsLabel}` : `${toolsCount} tools`);
  } else if (thoughtsCount > 1) {
    parts.push(isDe ? `${thoughtsCount} ${thoughtsLabel}` : `${thoughtsCount} thoughts`);
  }

  if (distinctToolNames.length > 0) {
    const formattedTools = distinctToolNames.map(formatToolShortTag);
    const uniqueTools = Array.from(new Set(formattedTools)).slice(0, 4);
    parts.push(`(${uniqueTools.join(', ')})`);
  }

  return {
    title,
    breakdown: parts.join(' · '),
  };
}

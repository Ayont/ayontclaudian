import { setIcon } from 'obsidian';

import { getWorkspaceQuickPrompts } from '../../../core/workspace/workspaceMode';

/**
 * Shared welcome-screen content: greeting, mode-aware subline, and T3-style
 * starter chips. BOTH mode variants stay in the DOM — CSS shows only the set
 * matching the container's `claudian-mode-*` class.
 */
export function applyWelcomePrompt(welcomeEl: HTMLElement, prompt: string): HTMLTextAreaElement | null {
  const root = welcomeEl.closest('.claudian-tab-content') ?? welcomeEl.parentElement;
  const input = root?.querySelector?.('.claudian-input') as HTMLTextAreaElement | null;
  if (!input) {
    return null;
  }
  input.value = prompt;
  input.focus?.();
  input.setSelectionRange?.(prompt.length, prompt.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

export function renderWelcomeContent(welcomeEl: HTMLElement, greeting: string): void {
  welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: greeting });

  const codeEnv = welcomeEl.createDiv({ cls: 'claudian-welcome-env claudian-welcome-env--code' });
  const codeBadge = codeEnv.createDiv({ cls: 'claudian-welcome-mode-badge claudian-welcome-mode-badge--code' });
  const codeIcon = codeBadge.createSpan({ cls: 'claudian-welcome-mode-icon' });
  setIcon(codeIcon, 'cpu');
  codeBadge.createSpan({ text: 'CODEX DEV STUDIO · MULTI-AGENT SWARM' });
  codeEnv.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--code',
    text: 'Spezialisiert auf Software-Entwicklung, Multi-Agenten-Orchestrierung, Tests & Refactoring',
  });

  const workEnv = welcomeEl.createDiv({ cls: 'claudian-welcome-env claudian-welcome-env--work' });
  const workBadge = workEnv.createDiv({ cls: 'claudian-welcome-mode-badge claudian-welcome-mode-badge--work' });
  const workIcon = workBadge.createSpan({ cls: 'claudian-welcome-mode-icon' });
  setIcon(workIcon, 'scale');
  workBadge.createSpan({ text: 'CHATGPT WORK · LEGAL & ENTERPRISE' });
  workEnv.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--work',
    text: 'Spezialisiert auf DSGVO, EU AI Act, Dokument-Versionen, Verträge & akademische Normen',
  });

  const starters = welcomeEl.createDiv({ cls: 'claudian-welcome-starters' });
  for (const mode of ['code', 'work'] as const) {
    const group = starters.createDiv({
      cls: `claudian-welcome-starter-group claudian-welcome-starter-group--${mode}`,
    });
    for (const quick of getWorkspaceQuickPrompts(mode)) {
      const chip = group.createEl('button', {
        cls: 'claudian-welcome-starter',
        attr: { type: 'button' },
      });
      const iconEl = chip.createSpan({ cls: 'claudian-welcome-starter-icon' });
      setIcon(iconEl, quick.icon);
      chip.createSpan({ cls: 'claudian-welcome-starter-label', text: quick.label });
      chip.addEventListener('click', () => {
        applyWelcomePrompt(welcomeEl, quick.prompt);
      });
    }
  }
}

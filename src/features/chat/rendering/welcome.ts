import { setIcon } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { getSmartPromptSuggestions, type SmartPromptItem } from '../services/SmartPromptService';

/**
 * Shared welcome-screen content: greeting, mode-aware subline, and
 * intelligent "Was steht an?" history and memory prompts.
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

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting: string,
  plugin?: ClaudianPlugin,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: greeting });

  const codeEnv = welcomeEl.createDiv({ cls: 'claudian-welcome-env claudian-welcome-env--code' });
  const codeBadge = codeEnv.createDiv({ cls: 'claudian-welcome-mode-badge claudian-welcome-mode-badge--code' });
  const codeIcon = codeBadge.createSpan({ cls: 'claudian-welcome-mode-icon' });
  setIcon(codeIcon, 'cpu');
  codeBadge.createSpan({ text: 'CODE STUDIO · MULTI-AGENT SWARM' });
  codeEnv.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--code',
    text: 'Spezialisiert auf Software-Entwicklung, Multi-Agenten-Orchestrierung, Tests & Refactoring',
  });

  const workEnv = welcomeEl.createDiv({ cls: 'claudian-welcome-env claudian-welcome-env--work' });
  const workBadge = workEnv.createDiv({ cls: 'claudian-welcome-mode-badge claudian-welcome-mode-badge--work' });
  const workIcon = workBadge.createSpan({ cls: 'claudian-welcome-mode-icon' });
  setIcon(workIcon, 'scale');
  workBadge.createSpan({ text: 'WORK STUDIO · LEGAL & ENTERPRISE' });
  workEnv.createDiv({
    cls: 'claudian-welcome-sub claudian-welcome-sub--work',
    text: 'Spezialisiert auf DSGVO, EU AI Act, Dokument-Versionen, Verträge & akademische Normen',
  });

  // "Was steht an?" - Dynamic History & Memory suggestions section
  const agendaSection = welcomeEl.createDiv({ cls: 'claudian-welcome-agenda' });
  const agendaHeader = agendaSection.createDiv({ cls: 'claudian-welcome-agenda-header' });
  const sparkleIcon = agendaHeader.createSpan({ cls: 'claudian-welcome-agenda-icon' });
  setIcon(sparkleIcon, 'sparkles');
  agendaHeader.createSpan({ cls: 'claudian-welcome-agenda-title', text: 'Was steht an?' });

  const agendaList = agendaSection.createDiv({ cls: 'claudian-welcome-agenda-list' });

  const renderItems = (items: SmartPromptItem[]): void => {
    agendaList.empty();
    for (const item of items) {
      const card = agendaList.createEl('button', {
        cls: `claudian-welcome-agenda-card claudian-welcome-agenda-card--${item.kind} clickable-icon`,
        attr: { type: 'button', 'data-prompt': item.prompt },
      });

      const iconEl = card.createSpan({ cls: 'claudian-welcome-agenda-item-icon' });
      setIcon(iconEl, item.icon);

      const contentWrap = card.createDiv({ cls: 'claudian-welcome-agenda-item-content' });
      const topRow = contentWrap.createDiv({ cls: 'claudian-welcome-agenda-item-top' });
      topRow.createSpan({ cls: `claudian-welcome-agenda-tag claudian-welcome-agenda-tag--${item.kind}`, text: item.tag });
      contentWrap.createSpan({ cls: 'claudian-welcome-agenda-label', text: item.label });

      const arrowEl = card.createSpan({ cls: 'claudian-welcome-agenda-arrow' });
      setIcon(arrowEl, 'arrow-up-right');

      card.addEventListener('click', () => {
        applyWelcomePrompt(welcomeEl, item.prompt);
      });
    }
  };

  // Default initial items
  const initialItems: SmartPromptItem[] = [
    {
      id: 'init:1',
      kind: 'history',
      tag: 'Verlauf',
      label: 'Letzten Arbeitsschritt fortsetzen',
      prompt: 'Was steht als Nächstes an? Lass uns an der letzten Aufgabe weiterarbeiten: ',
      icon: 'history',
    },
    {
      id: 'init:2',
      kind: 'memory',
      tag: 'Memory',
      label: 'Projekt-Fokus & Erinnerungen prüfen',
      prompt: 'Rufe die wichtigsten gespeicherten Erinnerungen und Notizen zu diesem Projekt auf: ',
      icon: 'brain',
    },
    {
      id: 'init:3',
      kind: 'context',
      tag: 'Aufgabe',
      label: 'Was steht an? Offene Punkte planen',
      prompt: 'Was steht heute an? Analysiere den aktuellen Stand und schlage die wichtigsten Schritte vor.',
      icon: 'sparkles',
    },
  ];
  renderItems(initialItems);

  // If plugin is available, asynchronously load personalized history and memory notes
  if (plugin) {
    void (async () => {
      try {
        const isWork = welcomeEl.closest('.claudian-container')?.classList.contains('claudian-mode-work') ?? false;
        const smartItems = await getSmartPromptSuggestions(plugin, isWork ? 'work' : 'code', 4);
        if (smartItems.length > 0 && welcomeEl.isConnected) {
          renderItems(smartItems);
        }
      } catch {
        // Keep initial items on error
      }
    })();
  }
}

import { Setting } from 'obsidian';

import type { PersistedKimiProviderSettings } from '../settings';

/**
 * Read-only visualization of the Kimi Code feature surface, rendered at the top
 * of the Kimi settings tab. Groups every documented capability into labelled
 * chips so the full feature set is visible at a glance. Chips for modes that are
 * currently active (per the user's settings) are highlighted, so it doubles as a
 * live "what is switched on" indicator. Sourced from kimi.com/code/docs.
 */

interface KimiFeatureGroup {
  title: string;
  desc: string;
  /** Chip label, plus an optional flag key used to highlight active modes. */
  items: Array<{ label: string; flag?: string }>;
}

const KIMI_FEATURE_GROUPS: KimiFeatureGroup[] = [
  {
    title: 'Modi',
    desc: 'Laufmodi, die das Verhalten pro Session steuern.',
    items: [
      { label: 'Thinking', flag: 'thinking' },
      { label: 'Plan-Mode' },
      { label: 'Goal-Mode' },
      { label: 'Swarm-Mode' },
      { label: 'YOLO', flag: 'yolo' },
      { label: 'Auto-Approve' },
      { label: 'AFK / Print' },
    ],
  },
  {
    title: 'Slash-Commands',
    desc: 'Interaktive Kommandos im CLI.',
    items: [
      { label: '/model' }, { label: '/plan' }, { label: '/goal' }, { label: '/swarm' },
      { label: '/sessions' }, { label: '/fork' }, { label: '/compact' }, { label: '/undo' },
      { label: '/tasks' }, { label: '/usage' }, { label: '/status' }, { label: '/mcp' },
      { label: '/init' }, { label: '/permission' }, { label: '/theme' }, { label: '/plugins' },
    ],
  },
  {
    title: 'Agentic',
    desc: 'Tool-Use & autonome Ausführung.',
    items: [
      { label: 'coder / explore / plan Subagents' },
      { label: 'Web-Fetch + Search' },
      { label: 'Datei-RW + Shell' },
      { label: 'Background-Tasks' },
      { label: 'Ralph-Loop' },
      { label: 'Auto-Compaction' },
    ],
  },
  {
    title: 'Integration',
    desc: 'Anbindung an Editoren & Tools.',
    items: [
      { label: 'MCP (http/stdio/sse)' },
      { label: 'ACP 0.23' },
      { label: 'Hooks' },
      { label: 'Skills' },
      { label: 'Plugins' },
      { label: 'Import aus Claude Code / Codex' },
    ],
  },
  {
    title: 'Modelle',
    desc: 'Auswählbar über den Modell-Picker.',
    items: [
      { label: 'K2.7 Code' },
      { label: 'K2.6' },
      { label: 'K2 Thinking' },
      { label: 'K2 Turbo' },
      { label: 'Moonshot v1' },
    ],
  },
];

const KIMI_DOCS_URL = 'https://www.kimi.com/code/docs/en/';

/** Resolves which mode chips should render as active from current settings. */
function getActiveFlags(settings: PersistedKimiProviderSettings): Set<string> {
  const active = new Set<string>();
  if (settings.thinkingDefault) {
    active.add('thinking');
  }
  if (settings.permissionMode === 'yolo') {
    active.add('yolo');
  }
  return active;
}

export function renderKimiFeatureShowcase(
  container: HTMLElement,
  settings: PersistedKimiProviderSettings,
): void {
  const activeFlags = getActiveFlags(settings);

  const heading = new Setting(container).setName('Kimi Code Features').setHeading();
  heading.addExtraButton((button) => {
    button.setIcon('help-circle').setTooltip('Kimi Code Dokumentation öffnen');
    button.onClick(() => window.open(KIMI_DOCS_URL, '_blank'));
  });

  container.createEl('p', {
    cls: 'claudian-kimi-feature-hint',
    text: 'Alle Kimi-Code-Funktionen im Überblick. Aktive Modi sind hervorgehoben.',
  });

  const grid = container.createDiv({ cls: 'claudian-kimi-feature-grid' });

  for (const group of KIMI_FEATURE_GROUPS) {
    const card = grid.createDiv({ cls: 'claudian-kimi-feature-group' });
    card.createDiv({ cls: 'claudian-kimi-feature-group-title', text: group.title });
    card.createDiv({ cls: 'claudian-kimi-feature-group-desc', text: group.desc });

    const chips = card.createDiv({ cls: 'claudian-kimi-feature-chips' });
    for (const item of group.items) {
      const isActive = item.flag !== undefined && activeFlags.has(item.flag);
      const chip = chips.createSpan({
        cls: 'claudian-kimi-feature-chip',
        text: item.label,
      });
      chip.toggleClass('is-active', isActive);
      if (isActive) {
        chip.setAttribute('aria-label', `${item.label} (aktiv)`);
      }
    }
  }
}

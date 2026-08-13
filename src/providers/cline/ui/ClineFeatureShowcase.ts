import type { PersistedClineProviderSettings } from '../settings';

interface ClineFeatureGroup {
  desc: string;
  items: Array<{ flag?: string; label: string }>;
  title: string;
}

const CLINE_FEATURE_GROUPS: ClineFeatureGroup[] = [
  {
    title: 'Lauf',
    desc: 'Headless `cline --json` — Plan/Act, Thinking, YOLO.',
    items: [
      { label: 'JSON-Stream', flag: 'json' },
      { label: 'YOLO / Act', flag: 'yolo' },
      { label: 'Plan', flag: 'plan' },
      { label: 'Thinking', flag: 'thinking' },
      { label: 'Session-Resume' },
    ],
  },
  {
    title: 'ClinePass',
    desc: 'Abo-Modelle mit `provider/model`.',
    items: [
      { label: 'Kimi K3' },
      { label: 'GLM-5.2' },
      { label: 'DeepSeek V4' },
      { label: 'Qwen 3.8' },
      { label: 'MiniMax / MiMo' },
    ],
  },
  {
    title: 'CLI',
    desc: 'Offizielle Flags, die ayontclaudian setzt.',
    items: [
      { label: '--json' },
      { label: '--yolo' },
      { label: '-P / -m' },
      { label: '--thinking' },
      { label: '--plan' },
      { label: '--id' },
      { label: '--compaction' },
      { label: 'cline auth' },
    ],
  },
];

export function renderClineFeatureShowcase(
  container: HTMLElement,
  settings: PersistedClineProviderSettings,
): void {
  const hint = container.createDiv({ cls: 'claudian-cline-feature-hint' });
  hint.setText('Cline läuft hier als Headless-CLI — dieselben Modelle und Tools wie im Terminal.');

  const grid = container.createDiv({ cls: 'claudian-cline-feature-grid' });
  for (const group of CLINE_FEATURE_GROUPS) {
    const card = grid.createDiv({ cls: 'claudian-cline-feature-group' });
    card.createDiv({ cls: 'claudian-cline-feature-group-title', text: group.title });
    card.createDiv({ cls: 'claudian-cline-feature-group-desc', text: group.desc });
    const chips = card.createDiv({ cls: 'claudian-cline-feature-chips' });
    for (const item of group.items) {
      const chip = chips.createSpan({ cls: 'claudian-cline-feature-chip', text: item.label });
      if (item.flag && isClineFeatureActive(item.flag, settings)) {
        chip.addClass('is-active');
      }
    }
  }
}

function isClineFeatureActive(flag: string, settings: PersistedClineProviderSettings): boolean {
  if (flag === 'json') {
    return settings.enabled;
  }
  if (flag === 'yolo') {
    return settings.permissionMode === 'yolo';
  }
  if (flag === 'plan') {
    return settings.permissionMode === 'plan';
  }
  if (flag === 'thinking') {
    return settings.thinking !== 'none';
  }
  return false;
}

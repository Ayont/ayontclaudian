export const CHAT_APPEARANCE_PRESETS = [
  'host',
  'ember',
  'midnight',
  'moss',
  'iris',
  'sand',
  'custom',
] as const;

export type ChatAppearancePreset = typeof CHAT_APPEARANCE_PRESETS[number];

export interface ChatAppearanceSettings {
  preset: ChatAppearancePreset;
  accent: string;
  userBubble: string;
  composer: string;
}

export interface ChatAppearanceTokens {
  preset: ChatAppearancePreset;
  overridesBrand: boolean;
  accent: string;
  accentRgb: string;
  userBubble: string;
  composer: string;
}

interface PresetSwatch {
  accent: string;
  userBubble: string;
  composerDark: string;
  composerLight: string;
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearanceSettings = {
  preset: 'host',
  accent: '#d97757',
  userBubble: '#d97757',
  composer: '',
};

const PRESET_SWATCHES: Record<Exclude<ChatAppearancePreset, 'host' | 'custom'>, PresetSwatch> = {
  ember: {
    accent: '#d97757',
    userBubble: '#d97757',
    composerDark: '#2a201c',
    composerLight: '#f6e8e1',
  },
  midnight: {
    accent: '#6ea8fe',
    userBubble: '#6ea8fe',
    composerDark: '#1a2230',
    composerLight: '#e6eefc',
  },
  moss: {
    accent: '#5aa87a',
    userBubble: '#5aa87a',
    composerDark: '#1b2620',
    composerLight: '#e3f0e7',
  },
  iris: {
    accent: '#8b7cf6',
    userBubble: '#8b7cf6',
    composerDark: '#221f32',
    composerLight: '#ece8fb',
  },
  sand: {
    accent: '#d4a054',
    userBubble: '#d4a054',
    composerDark: '#2a2418',
    composerLight: '#f6edd9',
  },
};

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

export function isChatAppearancePreset(value: unknown): value is ChatAppearancePreset {
  return typeof value === 'string' && (CHAT_APPEARANCE_PRESETS as readonly string[]).includes(value);
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  const six = trimmed.match(HEX6);
  if (six) {
    return `#${six[1].toLowerCase()}`;
  }
  const three = trimmed.match(HEX3);
  if (three) {
    const [r, g, b] = three[1].toLowerCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export function hexToRgbChannel(hex: string): string {
  const normalized = normalizeHexColor(hex, '#000000').slice(1);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function normalizeChatAppearance(value: unknown): ChatAppearanceSettings {
  const raw = value && typeof value === 'object' ? value as Partial<ChatAppearanceSettings> : {};
  return {
    preset: isChatAppearancePreset(raw.preset) ? raw.preset : DEFAULT_CHAT_APPEARANCE.preset,
    accent: normalizeHexColor(raw.accent, DEFAULT_CHAT_APPEARANCE.accent),
    userBubble: normalizeHexColor(raw.userBubble, DEFAULT_CHAT_APPEARANCE.userBubble),
    composer: raw.composer === undefined || raw.composer === null
      ? DEFAULT_CHAT_APPEARANCE.composer
      : (typeof raw.composer === 'string' && raw.composer.trim() === ''
        ? ''
        : normalizeHexColor(raw.composer, DEFAULT_CHAT_APPEARANCE.accent)),
  };
}

export function resolveChatAppearance(
  appearance: ChatAppearanceSettings | undefined,
  isLight: boolean,
): ChatAppearanceTokens {
  const settings = normalizeChatAppearance(appearance);
  if (settings.preset === 'host') {
    return {
      preset: 'host',
      overridesBrand: false,
      accent: settings.accent,
      accentRgb: hexToRgbChannel(settings.accent),
      userBubble: settings.userBubble,
      composer: '',
    };
  }

  if (settings.preset === 'custom') {
    return {
      preset: 'custom',
      overridesBrand: true,
      accent: settings.accent,
      accentRgb: hexToRgbChannel(settings.accent),
      userBubble: settings.userBubble,
      composer: settings.composer,
    };
  }

  const swatch = PRESET_SWATCHES[settings.preset];
  return {
    preset: settings.preset,
    overridesBrand: true,
    accent: swatch.accent,
    accentRgb: hexToRgbChannel(swatch.accent),
    userBubble: swatch.userBubble,
    composer: isLight ? swatch.composerLight : swatch.composerDark,
  };
}

function writeCssVar(style: CSSStyleDeclaration, name: string, value: string | null): void {
  if (value === null) {
    if (typeof style.removeProperty === 'function') {
      style.removeProperty(name);
    } else {
      delete (style as unknown as Record<string, string>)[name];
    }
    return;
  }
  if (typeof style.setProperty === 'function') {
    style.setProperty(name, value);
    return;
  }
  (style as unknown as Record<string, string>)[name] = value;
}

function readCssVar(style: CSSStyleDeclaration, name: string): string {
  if (typeof style.getPropertyValue === 'function') {
    return style.getPropertyValue(name);
  }
  return (style as unknown as Record<string, string>)[name] ?? '';
}

export function applyChatAppearanceToContainer(
  el: HTMLElement,
  appearance: ChatAppearanceSettings | undefined,
  isLight: boolean,
): void {
  const tokens = resolveChatAppearance(appearance, isLight);
  el.dataset.chatTheme = tokens.preset;

  if (!tokens.overridesBrand) {
    writeCssVar(el.style, '--claudian-brand', null);
    writeCssVar(el.style, '--claudian-brand-rgb', null);
    writeCssVar(el.style, '--cl-user-bubble', null);
    writeCssVar(el.style, '--cl-composer-tint', null);
    return;
  }

  writeCssVar(el.style, '--claudian-brand', tokens.accent);
  writeCssVar(el.style, '--claudian-brand-rgb', tokens.accentRgb);
  writeCssVar(el.style, '--cl-user-bubble', tokens.userBubble);
  writeCssVar(el.style, '--cl-composer-tint', tokens.composer || null);
}

export { readCssVar };

export function getChatAppearancePresetMeta(preset: ChatAppearancePreset): {
  id: ChatAppearancePreset;
  swatch: string;
} {
  if (preset === 'host') {
    return { id: preset, swatch: 'var(--text-muted)' };
  }
  if (preset === 'custom') {
    return { id: preset, swatch: 'conic-gradient(#d97757, #6ea8fe, #5aa87a, #8b7cf6, #d4a054)' };
  }
  return { id: preset, swatch: PRESET_SWATCHES[preset].accent };
}

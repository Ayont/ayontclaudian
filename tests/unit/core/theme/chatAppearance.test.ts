import { createMockEl } from '@test/helpers/mockElement';

import {
  applyChatAppearanceToContainer,
  DEFAULT_CHAT_APPEARANCE,
  hexToRgbChannel,
  normalizeChatAppearance,
  normalizeHexColor,
  readCssVar,
  resolveChatAppearance,
} from '@/core/theme/chatAppearance';

describe('normalizeHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(normalizeHexColor('#abc', '#000000')).toBe('#aabbcc');
    expect(normalizeHexColor('#D97757', '#000000')).toBe('#d97757');
  });

  it('falls back on junk', () => {
    expect(normalizeHexColor('blue', '#d97757')).toBe('#d97757');
    expect(normalizeHexColor(null, '#d97757')).toBe('#d97757');
  });
});

describe('hexToRgbChannel', () => {
  it('converts hex to rgb channels', () => {
    expect(hexToRgbChannel('#d97757')).toBe('217, 119, 87');
    expect(hexToRgbChannel('#fff')).toBe('255, 255, 255');
  });
});

describe('normalizeChatAppearance', () => {
  it('fills defaults for missing or invalid values', () => {
    expect(normalizeChatAppearance(undefined)).toEqual(DEFAULT_CHAT_APPEARANCE);
    expect(normalizeChatAppearance({ preset: 'iris' }).preset).toBe('iris');
    expect(normalizeChatAppearance({ preset: 'nope' }).preset).toBe('host');
  });
});

describe('resolveChatAppearance', () => {
  it('leaves host theme without overrides', () => {
    const tokens = resolveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, preset: 'host' }, false);
    expect(tokens.overridesBrand).toBe(false);
  });

  it('resolves named presets and custom colors', () => {
    const moss = resolveChatAppearance({ ...DEFAULT_CHAT_APPEARANCE, preset: 'moss' }, false);
    expect(moss.overridesBrand).toBe(true);
    expect(moss.accent.startsWith('#')).toBe(true);

    const custom = resolveChatAppearance({
      preset: 'custom',
      accent: '#112233',
      userBubble: '#445566',
      composer: '#778899',
    }, false);
    expect(custom.accent).toBe('#112233');
    expect(custom.userBubble).toBe('#445566');
    expect(custom.composer).toBe('#778899');
  });
});

describe('applyChatAppearanceToContainer', () => {
  it('sets brand overrides for a preset and clears them for host', () => {
    const el = createMockEl();
    applyChatAppearanceToContainer(el, { ...DEFAULT_CHAT_APPEARANCE, preset: 'ember' }, false);
    expect(el.dataset.chatTheme).toBe('ember');
    expect(readCssVar(el.style, '--claudian-brand')).toBe('#d97757');
    expect(readCssVar(el.style, '--claudian-brand-rgb')).toBe('217, 119, 87');

    applyChatAppearanceToContainer(el, DEFAULT_CHAT_APPEARANCE, false);
    expect(el.dataset.chatTheme).toBe('host');
    expect(readCssVar(el.style, '--claudian-brand')).toBe('');
  });
});

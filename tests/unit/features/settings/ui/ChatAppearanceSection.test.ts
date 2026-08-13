import { createMockEl } from '@test/helpers/mockElement';

import { syncThemeSwatchSelection } from '@/features/settings/ui/ChatAppearanceSection';

describe('syncThemeSwatchSelection', () => {
  it('marks only the chosen preset as active', () => {
    const host = createMockEl('button');
    const ember = createMockEl('button');
    host.addClass('claudian-theme-swatch');
    host.addClass('is-active');
    ember.addClass('claudian-theme-swatch');
    host.setAttribute('aria-pressed', 'true');
    ember.setAttribute('aria-pressed', 'false');

    syncThemeSwatchSelection([
      { preset: 'host', el: host },
      { preset: 'ember', el: ember },
    ], 'ember');

    expect(host.hasClass('is-active')).toBe(false);
    expect(ember.hasClass('is-active')).toBe(true);
    expect(host.getAttribute('aria-pressed')).toBe('false');
    expect(ember.getAttribute('aria-pressed')).toBe('true');
  });
});

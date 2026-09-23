import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import {
  ContextPressureBanner,
  type ContextPressureViewState,
} from '@/features/chat/ui/ContextPressureBanner';
import { setLocale } from '@/i18n/i18n';

function state(overrides: Partial<ContextPressureViewState> = {}): ContextPressureViewState {
  return {
    level: 'high',
    percentage: 84,
    contextTokens: 168_000,
    contextWindow: 200_000,
    approximate: false,
    compactCommand: '/compact',
    streaming: false,
    condensing: false,
    ...overrides,
  };
}

function createBanner() {
  const mount = createMockEl();
  const callbacks = { onCompact: jest.fn(), onContinueFresh: jest.fn(), onDismiss: jest.fn() };
  const banner = new ContextPressureBanner(mount as any, callbacks);
  const root = () => mount.querySelector('.claudian-context-pressure');
  const byClass = (cls: string) => mount.querySelector(`.${cls}`);
  return { banner, mount, callbacks, root, byClass };
}

function click(el: any): void {
  el._eventListeners.get('click')[0]({ preventDefault: jest.fn(), stopPropagation: jest.fn() });
}

describe('ContextPressureBanner', () => {
  afterEach(() => setLocale('en'));

  it('stays hidden until there is pressure to show', () => {
    const { banner, root } = createBanner();
    expect(root()?.hasClass('claudian-hidden')).toBe(true);
    banner.render(null);
    expect(root()?.hasClass('claudian-hidden')).toBe(true);
    expect(banner.isVisible()).toBe(false);
  });

  it('renders the high level with percentage, token usage and explanation in German', () => {
    setLocale('de');
    const { banner, root, byClass } = createBanner();
    banner.render(state());

    expect(banner.isVisible()).toBe(true);
    expect(root()?.hasClass('claudian-hidden')).toBe(false);
    expect(root()?.getAttribute('data-level')).toBe('high');
    expect(root()?.getAttribute('aria-label')).toBe('Warnung zur Kontextauslastung');
    expect(byClass('claudian-context-pressure-title')?.textContent).toBe('Kontext wird knapp');
    expect(byClass('claudian-context-pressure-percent')?.textContent).toBe('84 %');
    expect(byClass('claudian-context-pressure-usage')?.textContent).toBe('168k von 200k Tokens');
    expect(byClass('claudian-context-pressure-text')?.textContent).toContain('Kontextfensters');
    expect(byClass('claudian-context-pressure-meter-fill')?.style['--claudian-pressure-fill']).toBe('0.84');
  });

  it('renders the same banner in English when that is the selected language', () => {
    setLocale('en');
    const { banner, byClass } = createBanner();
    banner.render(state());
    expect(byClass('claudian-context-pressure-title')?.textContent).toBe('Context is filling up');
    expect(byClass('claudian-context-pressure-percent')?.textContent).toBe('84%');
    expect(byClass('claudian-context-pressure-usage')?.textContent).toBe('168k of 200k tokens');
    expect(byClass('claudian-context-pressure-action--compact')?.textContent).toBe('Compact');
    expect(byClass('claudian-context-pressure-action--fresh')?.textContent).toBe('Continue with less context');
  });

  it('marks the critical level with its own copy and icon, not colour alone', () => {
    const { banner, root, byClass } = createBanner();
    (setIcon as jest.Mock).mockClear();
    banner.render(state({ level: 'critical', percentage: 95 }));

    expect(root()?.getAttribute('data-level')).toBe('critical');
    expect(root()?.hasClass('is-critical')).toBe(true);
    expect(byClass('claudian-context-pressure-title')?.textContent).toBe('Context almost full');
    expect(byClass('claudian-context-pressure-text')?.textContent).toContain('exceed the limit');
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'alert-triangle');
  });

  it('marks estimated usage as approximate', () => {
    const { banner, byClass } = createBanner();
    banner.render(state({ approximate: true }));
    expect(byClass('claudian-context-pressure-percent')?.textContent).toBe('≈84%');
    expect(byClass('claudian-context-pressure-usage')?.textContent).toBe('≈ 168k of 200k tokens (estimated)');
  });

  it('offers compact as the primary action only when the provider supports it', () => {
    const { banner, byClass, callbacks } = createBanner();
    banner.render(state({ compactCommand: '/compress' }));
    const compact = byClass('claudian-context-pressure-action--compact');
    expect(compact?.hasClass('claudian-hidden')).toBe(false);
    expect(compact?.hasClass('is-primary')).toBe(true);
    expect(compact?.getAttribute('title')).toContain('/compress');
    expect(byClass('claudian-context-pressure-action--fresh')?.hasClass('is-primary')).toBe(false);
    click(compact);
    expect(callbacks.onCompact).toHaveBeenCalledTimes(1);

    banner.render(state({ compactCommand: null }));
    expect(compact?.hasClass('claudian-hidden')).toBe(true);
    expect(byClass('claudian-context-pressure-action--fresh')?.hasClass('is-primary')).toBe(true);
  });

  it('routes continue and dismiss to their callbacks', () => {
    const { banner, byClass, callbacks } = createBanner();
    banner.render(state());
    click(byClass('claudian-context-pressure-action--fresh'));
    click(byClass('claudian-context-pressure-dismiss'));
    expect(callbacks.onContinueFresh).toHaveBeenCalledTimes(1);
    expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('disables the actions and explains why while an answer is streaming', () => {
    const { banner, byClass, callbacks } = createBanner();
    banner.render(state({ streaming: true }));
    const compact = byClass('claudian-context-pressure-action--compact') as any;
    const fresh = byClass('claudian-context-pressure-action--fresh') as any;
    expect(compact.disabled).toBe(true);
    expect(fresh.disabled).toBe(true);
    expect(byClass('claudian-context-pressure-note')?.hasClass('claudian-hidden')).toBe(false);
    expect(byClass('claudian-context-pressure-note')?.textContent).toBe('Available once the current answer has finished.');
    click(compact);
    expect(callbacks.onCompact).not.toHaveBeenCalled();

    banner.render(state({ streaming: false }));
    expect(compact.disabled).toBe(false);
    expect(byClass('claudian-context-pressure-note')?.hasClass('claudian-hidden')).toBe(true);
  });

  it('shows a busy state while the history is condensed', () => {
    const { banner, root, byClass } = createBanner();
    banner.render(state({ condensing: true }));
    const fresh = byClass('claudian-context-pressure-action--fresh') as any;
    expect(root()?.getAttribute('aria-busy')).toBe('true');
    expect(fresh.disabled).toBe(true);
    expect(fresh.hasClass('is-busy')).toBe(true);
    expect(fresh.textContent).toBe('Condensing history…');
    expect((byClass('claudian-context-pressure-action--compact') as any).disabled).toBe(true);
  });

  it('removes its DOM on destroy', () => {
    const { banner, mount } = createBanner();
    banner.destroy();
    expect(mount.querySelector('.claudian-context-pressure')).toBeNull();
  });
});

/** @jest-environment jsdom */

import {
  CLINE_PROVIDER_ICON,
  createProviderIconSvg,
  GROK_PROVIDER_ICON,
  OPENAI_PROVIDER_ICON,
  OPENCODE_PROVIDER_ICON,
  PI_PROVIDER_ICON,
  VIBE_PROVIDER_ICON,
} from '@/shared/icons';

describe('createProviderIconSvg', () => {
  it('renders path-based provider icons with currentColor fill', () => {
    const svg = createProviderIconSvg(OPENAI_PROVIDER_ICON, {
      className: 'test-icon',
      height: 12,
      ownerDocument: document,
      width: 12,
    });

    expect(svg.getAttribute('viewBox')).toBe(OPENAI_PROVIDER_ICON.viewBox);
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('height')).toBe('12');
    expect(svg.classList.contains('claudian-provider-icon')).toBe(true);
    expect(svg.classList.contains('test-icon')).toBe(true);

    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('currentColor');
  });

  it('renders composite provider icons with theme variants', () => {
    const svg = createProviderIconSvg(OPENCODE_PROVIDER_ICON, {
      dataProvider: 'opencode',
      height: 18,
      ownerDocument: document,
      width: 18,
    });

    expect(svg.getAttribute('data-provider')).toBe('opencode');
    expect(svg.getAttribute('viewBox')).toBe(OPENCODE_PROVIDER_ICON.viewBox);
    expect(svg.querySelector('.claudian-provider-icon-variant--light')).not.toBeNull();
    expect(svg.querySelector('.claudian-provider-icon-variant--dark')).not.toBeNull();
  });

  it('renders the Pi provider icon as currentColor composite paths', () => {
    const svg = createProviderIconSvg(PI_PROVIDER_ICON, {
      dataProvider: 'pi',
      ownerDocument: document,
    });

    expect(svg.getAttribute('viewBox')).toBe('0 0 800 800');
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('fill-rule')).toBe('evenodd');
    expect(paths.every(path => path.getAttribute('fill') === 'currentColor')).toBe(true);
  });

  it('renders the official Cline robot mark, not a placeholder ring', () => {
    const svg = createProviderIconSvg(CLINE_PROVIDER_ICON, { ownerDocument: document });
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(paths.some(path => path.getAttribute('d')?.startsWith('M17.035 3.991'))).toBe(true);
    expect(paths.some(path => path.getAttribute('d')?.includes('M12.054 5.558'))).toBe(true);
    expect(paths.every(path => path.getAttribute('fill') === 'currentColor')).toBe(true);
  });

  it('renders the official Grok swirl mark, not an X', () => {
    const svg = createProviderIconSvg(GROK_PROVIDER_ICON, { ownerDocument: document });
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(paths.some(path => path.getAttribute('d')?.startsWith('M9.27 15.29'))).toBe(true);
    expect(paths.every(path => path.getAttribute('d')?.includes('M3.5 3.5h4.2l4.3'))).toBe(false);
    expect(paths.every(path => path.getAttribute('fill') === 'currentColor')).toBe(true);
  });

  it('renders the official Mistral pixel-cat for Vibe', () => {
    const svg = createProviderIconSvg(VIBE_PROVIDER_ICON, { ownerDocument: document });
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(paths).toHaveLength(5);
    expect(paths.map(path => path.getAttribute('fill'))).toEqual([
      'gold',
      '#FFAF00',
      '#FF8205',
      '#FA500F',
      '#E10500',
    ]);
    expect(paths[0].getAttribute('d')).toContain('M3.428 3.4h3.429');
    expect(paths[4].getAttribute('d')).toContain('M0 17.114h10.286');
  });
});

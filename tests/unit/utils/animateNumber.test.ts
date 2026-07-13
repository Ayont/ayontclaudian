/** @jest-environment jsdom */

import { animateNumber, easeOutQuart } from '@/utils/animateNumber';

describe('animateNumber', () => {
  it('uses an ease-out curve with stable endpoints', () => {
    expect(easeOutQuart(-1)).toBe(0);
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(0.5)).toBeCloseTo(0.9375);
    expect(easeOutQuart(1)).toBe(1);
    expect(easeOutQuart(2)).toBe(1);
  });

  it('settles immediately when reduced motion is enabled', () => {
    const element = document.createElement('span');
    animateNumber(element, 1688, {
      from: 0,
      reducedMotion: true,
      formatter: (value) => String(value),
    });
    expect(element.textContent).toBe('1688');
    expect(element.classList.contains('is-counting')).toBe(false);
  });

  it('counts to the exact target through requestAnimationFrame', () => {
    const element = document.createElement('span');
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = jest.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    animateNumber(element, 100, {
      from: 20,
      duration: 100,
      reducedMotion: false,
      formatter: (value) => String(value),
      requestFrame,
      cancelFrame: jest.fn(),
    });

    callbacks.shift()?.(0);
    callbacks.shift()?.(50);
    expect(Number(element.textContent)).toBeGreaterThan(90);
    callbacks.shift()?.(100);
    expect(element.textContent).toBe('100');
    expect(element.classList.contains('is-counting')).toBe(false);
  });
});

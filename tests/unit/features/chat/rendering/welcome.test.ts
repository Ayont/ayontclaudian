import { createMockEl } from '@test/helpers/mockElement';

import { applyWelcomePrompt, renderWelcomeContent } from '@/features/chat/rendering/welcome';

describe('renderWelcomeContent', () => {
  it('keeps the greeting first and renders Was steht an? agenda suggestions', () => {
    const welcome = createMockEl();
    renderWelcomeContent(welcome, 'Guten Abend');

    expect(welcome.children[0].textContent).toBe('Guten Abend');
    expect(welcome.querySelector('.claudian-welcome-greeting')?.textContent).toBe('Guten Abend');
    expect(welcome.querySelector('.claudian-welcome-agenda')).toBeTruthy();
    expect(welcome.querySelector('.claudian-welcome-agenda-title')?.textContent).toBe('Was steht an?');

    const cards = welcome.querySelectorAll('.claudian-welcome-agenda-card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('fills the sibling composer when an agenda card is clicked', () => {
    const tab = createMockEl();
    tab.addClass('claudian-tab-content');
    const welcome = tab.createDiv({ cls: 'claudian-welcome' });
    const input = tab.createEl('textarea', { cls: 'claudian-input' });
    const onInput = jest.fn();
    input.addEventListener('input', onInput);

    renderWelcomeContent(welcome, 'Hey');
    const first = welcome.querySelector('.claudian-welcome-agenda-card') as HTMLElement;
    expect(first).toBeTruthy();
    first.click();

    expect(input.value.length).toBeGreaterThan(0);
    expect(onInput).toHaveBeenCalled();
  });
});

describe('applyWelcomePrompt', () => {
  it('returns null when no composer exists', () => {
    const welcome = createMockEl();
    expect(applyWelcomePrompt(welcome, 'hi')).toBeNull();
  });
});

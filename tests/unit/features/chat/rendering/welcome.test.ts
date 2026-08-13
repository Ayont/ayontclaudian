import { createMockEl } from '@test/helpers/mockElement';

import { getWorkspaceQuickPrompts } from '@/core/workspace/workspaceMode';
import { applyWelcomePrompt, renderWelcomeContent } from '@/features/chat/rendering/welcome';

describe('renderWelcomeContent', () => {
  it('keeps the greeting first and renders mode-aware starters', () => {
    const welcome = createMockEl();
    renderWelcomeContent(welcome, 'Guten Abend');

    expect(welcome.children[0].textContent).toBe('Guten Abend');
    expect(welcome.querySelector('.claudian-welcome-greeting')?.textContent).toBe('Guten Abend');
    expect(welcome.querySelector('.claudian-welcome-starter-group--code')).toBeTruthy();
    expect(welcome.querySelector('.claudian-welcome-starter-group--work')).toBeTruthy();

    const labels = welcome
      .querySelectorAll('.claudian-welcome-starter-label')
      .map((el: { textContent: string }) => el.textContent);
    expect(labels).toEqual([
      ...getWorkspaceQuickPrompts('code').map((quick) => quick.label),
      ...getWorkspaceQuickPrompts('work').map((quick) => quick.label),
    ]);
  });

  it('fills the sibling composer when a starter is clicked', () => {
    const tab = createMockEl();
    tab.addClass('claudian-tab-content');
    const welcome = tab.createDiv({ cls: 'claudian-welcome' });
    const input = tab.createEl('textarea', { cls: 'claudian-input' });
    const onInput = jest.fn();
    input.addEventListener('input', onInput);

    renderWelcomeContent(welcome, 'Hey');
    const first = welcome.querySelector('.claudian-welcome-starter');
    first!.click();

    expect(input.value).toBe(getWorkspaceQuickPrompts('code')[0].prompt);
    expect(onInput).toHaveBeenCalled();
  });
});

describe('applyWelcomePrompt', () => {
  it('returns null when no composer exists', () => {
    const welcome = createMockEl();
    expect(applyWelcomePrompt(welcome, 'hi')).toBeNull();
  });
});

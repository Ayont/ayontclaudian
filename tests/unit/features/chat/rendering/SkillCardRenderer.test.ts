/** @jest-environment jsdom */

import { parseSkillBlocks } from '@/core/skills/skillCreator';
import { renderSkillCards } from '@/features/chat/rendering/SkillCardRenderer';

function installObsidianDomHelpers(): void {
  (HTMLElement.prototype as any).createDiv = function createDiv(options?: { cls?: string; text?: string }) {
    const element = document.createElement('div');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createSpan = function createSpan(options?: { cls?: string; text?: string }) {
    const element = document.createElement('span');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createEl = function createEl(
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
}

const SKILL_FENCE = ['```claudian-skill', '---', 'name: demo-skill', 'description: Demo', '---', '# Demo', '```'].join('\n');

describe('renderSkillCards frame guard', () => {
  beforeAll(() => installObsidianDomHelpers());

  it('skips the rebuild when the mounted card content is unchanged', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code class="language-claudian-skill">demo</code></pre>';
    await renderSkillCards(root, SKILL_FENCE, { app: {} as never, component: {} as never });
    expect(root.querySelector('.claudian-skill-card')).not.toBeNull();
    const cardBefore = root.querySelector('.claudian-skill-card');

    await renderSkillCards(root, SKILL_FENCE, { app: {} as never, component: {} as never });
    expect(root.querySelector('.claudian-skill-card')).toBe(cardBefore);
  });

  it('still parses blocks through the shared parser', () => {
    expect(parseSkillBlocks(SKILL_FENCE)).toHaveLength(1);
  });
});
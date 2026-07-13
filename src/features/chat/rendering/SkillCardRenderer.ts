import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Notice, setIcon } from 'obsidian';

import {
  parseSkillBlocks,
  persistSkill,
  type SkillDefinition,
} from '../../../core/skills/skillCreator';

interface SkillRenderContext {
  app: App;
  component: Component;
}

function createIconButton(parent: HTMLElement, icon: string, label: string): HTMLElement {
  const btn = parent.createEl('button', {
    cls: 'claudian-skill-card-action',
    attr: { type: 'button', 'aria-label': label, title: label },
  });
  setIcon(btn, icon);
  return btn;
}

function flashButton(btn: HTMLElement, icon: string, restore: string): void {
  btn.empty();
  setIcon(btn, icon);
  window.setTimeout(() => {
    btn.empty();
    setIcon(btn, restore);
  }, 1400);
}

async function renderSkillCard(
  container: HTMLElement,
  skill: SkillDefinition,
  context: SkillRenderContext,
): Promise<HTMLElement> {
  const card = container.createDiv({ cls: 'claudian-skill-card' });

  const toolbar = card.createDiv({ cls: 'claudian-skill-card-toolbar' });
  const identity = toolbar.createDiv({ cls: 'claudian-skill-card-identity' });
  const icon = identity.createSpan({ cls: 'claudian-skill-card-icon' });
  setIcon(icon, 'sparkles');
  identity.createSpan({ cls: 'claudian-skill-card-label', text: 'Agent Skill' });
  identity.createSpan({ cls: 'claudian-skill-card-live', text: 'SKILL.md' });

  const actions = toolbar.createDiv({ cls: 'claudian-skill-card-actions' });
  const copyButton = createIconButton(actions, 'copy', 'SKILL.md kopieren');
  const saveButton = createIconButton(actions, 'save', 'In .claude/skills/ speichern');

  const head = card.createDiv({ cls: 'claudian-skill-card-head' });
  head.createEl('code', { cls: 'claudian-skill-card-name', text: skill.name });
  head.createEl('p', { cls: 'claudian-skill-card-description', text: skill.description });
  if (skill.allowedTools) {
    head.createEl('span', {
      cls: 'claudian-skill-card-tools',
      text: `Tools: ${skill.allowedTools}`,
    });
  }

  const bodyEl = card.createDiv({ cls: 'claudian-skill-card-body' });
  await MarkdownRenderer.render(context.app, skill.bodyPreview, bodyEl, '', context.component);

  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(skill.fileContent)
      .then(() => flashButton(copyButton, 'check', 'copy'))
      .catch(() => new Notice('SKILL.md konnte nicht kopiert werden.'));
  });

  saveButton.addEventListener('click', () => {
    void persistSkill(context.app.vault, skill)
      .then((path) => {
        new Notice(`Skill gespeichert: ${path}`);
        flashButton(saveButton, 'check', 'save');
      })
      .catch((error) => {
        new Notice(`Skill konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  return card;
}

/** Replaces claudian-skill code fences with a designed, streaming skill card. */
export async function renderSkillCards(
  root: HTMLElement,
  markdown: string,
  context: SkillRenderContext,
): Promise<boolean> {
  const blocks = parseSkillBlocks(markdown);
  const codeBlocks = Array.from(root.querySelectorAll('pre code.language-claudian-skill'));
  let rendered = false;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block.skill) continue;
    const code = codeBlocks[index];
    const pre = code?.closest('pre');
    if (pre?.parentElement) {
      const doc = root.ownerDocument ?? window.document;
      const host = doc.createElement('div');
      pre.parentElement.replaceChild(host, pre);
      await renderSkillCard(host, block.skill, context);
      rendered = true;
    } else if (!block.closed) {
      await renderSkillCard(root, block.skill, context);
      rendered = true;
    }
  }
  return rendered;
}

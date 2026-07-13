import { type App,Modal, Notice, requestUrl, setIcon } from 'obsidian';

import { getBuiltInCommandsForDropdown } from '../../core/commands/builtInCommands';
import type { ComparisonResult } from '../../core/compare/modelComparison';
import { loadMemoryNotes } from '../../core/memory/memoryService';
import { listSnippets } from '../../core/snippets/snippetService';
import type { Conversation } from '../../core/types';
import type ClaudianPlugin from '../../main';

interface CommandCenterItem {
  kind: 'Befehl' | 'Snippet' | 'Memory' | 'Skill';
  title: string;
  detail: string;
  insert: string;
}

function setComposer(plugin: ClaudianPlugin, value: string): void {
  const tab = plugin.getView()?.getActiveTab();
  if (!tab) {
    new Notice('Kein aktiver Chat verfügbar.');
    return;
  }
  tab.dom.inputEl.value = value;
  tab.dom.inputEl.focus();
  tab.dom.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

export class CommandCenterModal extends Modal {
  private items: CommandCenterItem[] = [];

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-command-center');
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: 'claudian-command-center-header' });
    const icon = header.createSpan();
    setIcon(icon, 'command');
    const heading = header.createDiv();
    heading.createEl('h2', { text: 'Produktivitätszentrale' });
    heading.createEl('p', { text: 'Befehle, Skills, Snippets und Erinnerungen an einem Ort.' });
    const search = this.contentEl.createEl('input', {
      cls: 'claudian-command-center-search',
      attr: { type: 'search', placeholder: 'Suchen …', 'aria-label': 'Produktivitätszentrale durchsuchen' },
    });
    const list = this.contentEl.createDiv({ cls: 'claudian-command-center-list' });
    this.items = await this.loadItems();

    const render = (): void => {
      const query = search.value.trim().toLowerCase();
      list.empty();
      const visible = this.items.filter((item) => `${item.kind} ${item.title} ${item.detail}`.toLowerCase().includes(query));
      for (const item of visible) {
        const row = list.createEl('button', { cls: 'claudian-command-center-item' });
        row.createSpan({ cls: 'claudian-command-center-kind', text: item.kind });
        const copy = row.createDiv({ cls: 'claudian-command-center-copy' });
        copy.createDiv({ cls: 'claudian-command-center-title', text: item.title });
        copy.createDiv({ cls: 'claudian-command-center-detail', text: item.detail });
        const arrow = row.createSpan();
        setIcon(arrow, 'corner-down-left');
        row.addEventListener('click', () => {
          setComposer(this.plugin, item.insert);
          this.close();
        });
      }
      if (visible.length === 0) list.createDiv({ cls: 'claudian-command-center-empty', text: 'Keine Treffer.' });
    };
    search.addEventListener('input', render);
    render();
    search.focus();
  }

  private async loadItems(): Promise<CommandCenterItem[]> {
    const commands: CommandCenterItem[] = getBuiltInCommandsForDropdown()
      .map((command) => ({
        kind: 'Befehl',
        title: `/${command.name}`,
        detail: command.description,
        insert: `/${command.name}${command.argumentHint ? ' ' : ''}`,
      }));
    const snippets = (await listSnippets(this.app.vault)).map((snippet): CommandCenterItem => ({
      kind: 'Snippet', title: snippet.name, detail: snippet.tags.join(' · ') || 'Gespeicherter Prompt', insert: snippet.body,
    }));
    const memories = (await loadMemoryNotes(this.app.vault, this.plugin.settings.memoryFolder ?? '.claudian/memory'))
      .slice(0, 60)
      .map((memory): CommandCenterItem => ({
        kind: 'Memory', title: memory.topic, detail: memory.tags.join(' · ') || memory.content.slice(0, 80), insert: memory.content,
      }));
    const skills: CommandCenterItem[] = [];
    const root = '.claude/skills';
    if (await this.app.vault.adapter.exists(root)) {
      const listing = await this.app.vault.adapter.list(root);
      for (const folder of listing.folders.slice(0, 100)) {
        const name = folder.split('/').pop() ?? folder;
        skills.push({ kind: 'Skill', title: name, detail: 'Agent Skill', insert: `$${name} ` });
      }
    }
    return [...commands, ...skills, ...snippets, ...memories];
  }
}

export class ModelComparisonModal extends Modal {
  constructor(
    app: App,
    private readonly prompt: string,
    private readonly results: ComparisonResult[],
  ) {
    super(app);
    this.modalEl.addClass('claudian-comparison-modal');
  }

  onOpen(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: 'claudian-comparison-header' });
    header.createEl('h2', { text: 'Modellvergleich' });
    header.createEl('p', { text: this.prompt });
    const grid = this.contentEl.createDiv({ cls: 'claudian-comparison-grid' });
    for (const result of this.results) {
      const column = grid.createEl('article', { cls: 'claudian-comparison-column' });
      const head = column.createDiv({ cls: 'claudian-comparison-column-head' });
      head.createEl('h3', { text: result.entry.label });
      head.createSpan({ text: `${(result.durationMs / 1000).toFixed(1)} s` });
      const body = column.createDiv({ cls: 'claudian-comparison-body' });
      body.setText(result.error ? `Fehler: ${result.error}` : result.text || 'Keine Antwort');
      const copy = column.createEl('button', { text: 'Antwort kopieren' });
      copy.addEventListener('click', () => void navigator.clipboard.writeText(result.text));
    }
  }
}

interface ConversationNode {
  conversation: Conversation;
  parentId?: string;
}

export class ConversationTreeModal extends Modal {
  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-conversation-tree-modal');
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Konversationsbaum' });
    this.contentEl.createEl('p', { text: 'Forks werden über ihre Provider-Sitzung dem Ursprung zugeordnet.' });
    const conversations = this.plugin.getConversationSnapshots();
    const sessionToId = new Map(conversations.flatMap((conversation) => conversation.sessionId ? [[conversation.sessionId, conversation.id]] : []));
    const nodes: ConversationNode[] = conversations.map((conversation) => {
      const source = (conversation.providerState?.forkSource as { sessionId?: string } | undefined)?.sessionId;
      return { conversation, parentId: source ? sessionToId.get(source) : undefined };
    });
    const children = new Map<string | undefined, ConversationNode[]>();
    for (const node of nodes) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    }
    const tree = this.contentEl.createDiv({ cls: 'claudian-conversation-tree' });
    const render = (parent: HTMLElement, node: ConversationNode, depth: number): void => {
      const row = parent.createEl('button', { cls: 'claudian-conversation-tree-node' });
      row.dataset.depth = String(Math.min(depth, 6));
      const icon = row.createSpan();
      setIcon(icon, depth ? 'git-branch' : 'message-square');
      const text = row.createDiv();
      text.createDiv({ cls: 'claudian-conversation-tree-title', text: node.conversation.title });
      text.createDiv({ cls: 'claudian-conversation-tree-meta', text: `${node.conversation.providerId} · ${node.conversation.messages.length} Nachrichten` });
      row.addEventListener('click', () => {
        void this.plugin.getView()?.getActiveTab()?.controllers.conversationController?.switchTo(node.conversation.id);
        this.close();
      });
      for (const child of children.get(node.conversation.id) ?? []) render(parent, child, depth + 1);
    };
    const roots = children.get(undefined) ?? nodes.filter((node) => !nodes.some((candidate) => candidate.conversation.id === node.parentId));
    for (const root of roots) render(tree, root, 0);
  }
}

function githubRawUrl(value: string): string {
  return value
    .replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, 'https://raw.githubusercontent.com/$1/$2/')
    .replace(/^https:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+).*$/i, 'https://gist.githubusercontent.com/$1/$2/raw');
}

export class SkillMarketplaceModal extends Modal {
  constructor(app: App) {
    super(app);
    this.modalEl.addClass('claudian-command-center');
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Skill-Marktplatz' });
    this.contentEl.createEl('p', { text: 'Importiert eine SKILL.md aus GitHub, einem Gist oder einer direkten HTTPS-Quelle.' });
    const input = this.contentEl.createEl('input', {
      cls: 'claudian-command-center-search',
      attr: { type: 'url', placeholder: 'https://github.com/…/SKILL.md', 'aria-label': 'Skill-Quelle' },
    });
    const preview = this.contentEl.createEl('pre', { cls: 'claudian-skill-market-preview' });
    const button = this.contentEl.createEl('button', { text: 'Prüfen und importieren' });
    button.addEventListener('click', () => {
      void this.importSkill(input.value, preview, button);
    });
  }

  private async importSkill(url: string, preview: HTMLElement, button: HTMLButtonElement): Promise<void> {
    if (!/^https:\/\//i.test(url.trim())) {
      new Notice('Bitte eine HTTPS-URL angeben.');
      return;
    }
    button.disabled = true;
    try {
      const response = await requestUrl({ url: githubRawUrl(url.trim()) });
      const content = response.text.trim();
      const name = content.match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
      const description = content.match(/^description:\s*(.+)$/m)?.[1];
      if (!content.startsWith('---') || !name || !description || name.length > 64) {
        throw new Error('Ungültige SKILL.md: Frontmatter mit name und description fehlt.');
      }
      preview.setText(content.slice(0, 1600));
      const root = `.claude/skills/${name}`;
      if (!(await this.app.vault.adapter.exists('.claude'))) await this.app.vault.adapter.mkdir('.claude');
      if (!(await this.app.vault.adapter.exists('.claude/skills'))) await this.app.vault.adapter.mkdir('.claude/skills');
      if (!(await this.app.vault.adapter.exists(root))) await this.app.vault.adapter.mkdir(root);
      await this.app.vault.adapter.write(`${root}/SKILL.md`, content);
      new Notice(`Skill importiert: ${name}`);
    } catch (error) {
      new Notice(`Skill-Import fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      button.disabled = false;
    }
  }
}

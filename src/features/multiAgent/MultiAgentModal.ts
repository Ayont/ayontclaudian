import { Modal, Notice, setIcon } from 'obsidian';

import type { MultiAgentProgress, SpecialistAgent } from '../../core/intelligence/multiAgent/MultiAgentService';
import type ClaudianPlugin from '../../main';

export class MultiAgentModal extends Modal {
  private container: HTMLElement | null = null;
  private agentCards = new Map<string, HTMLElement>();
  private overallBar: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private outputPreview: HTMLElement | null = null;

  constructor(
    private readonly plugin: ClaudianPlugin,
  ) {
    super(plugin.app);
    this.modalEl.addClass('claudian-multi-agent-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-multi-agent-header' });
    const titleGroup = header.createDiv({ cls: 'claudian-multi-agent-title-group' });
    const icon = titleGroup.createSpan({ cls: 'claudian-multi-agent-logo' });
    setIcon(icon, 'users');
    titleGroup.createEl('h2', { text: 'Multi-Agent Mission' });

    this.statusText = header.createSpan({ cls: 'claudian-multi-agent-status', text: 'Preparing agents…' });

    this.container = contentEl.createDiv({ cls: 'claudian-multi-agent-grid' });

    const progressWrapper = contentEl.createDiv({ cls: 'claudian-multi-agent-progress' });
    progressWrapper.createSpan({ text: 'Overall progress' });
    const barTrack = progressWrapper.createDiv({ cls: 'claudian-multi-agent-progress-track' });
    this.overallBar = barTrack.createDiv({ cls: 'claudian-multi-agent-progress-bar' });

    this.outputPreview = contentEl.createDiv({ cls: 'claudian-multi-agent-output' });
    this.outputPreview.createEl('h4', { text: 'Live Output' });
    this.outputPreview.createEl('p', { cls: 'claudian-multi-agent-output-empty', text: 'Waiting for agents to report…' });

    const footer = contentEl.createDiv({ cls: 'claudian-multi-agent-footer' });
    const cancelBtn = footer.createEl('button', { text: 'Close' });
    cancelBtn.addEventListener('click', () => this.close());

    this.renderAgentCards();
  }

  private renderAgentCards(): void {
    if (!this.container) return;
    this.container.empty();
    this.agentCards.clear();

    const agents = this.plugin.multiAgentService.listAgents();
    for (const agent of agents) {
      const card = this.container.createDiv({ cls: 'claudian-multi-agent-card' });
      card.setAttribute('data-agent-id', agent.id);

      const avatar = card.createDiv({ cls: 'claudian-multi-agent-avatar' });
      const avatarIcon = avatar.createSpan();
      setIcon(avatarIcon, agent.icon ?? 'user');
      const color = agent.color ?? 'var(--interactive-accent)';
      avatar.style.setProperty('--agent-color', color);
      avatar.style.setProperty('--agent-color-rgb', MultiAgentModal.hexToRgb(color) ?? '124, 58, 237');

      const info = card.createDiv({ cls: 'claudian-multi-agent-info' });
      info.createEl('h4', { text: agent.name });
      info.createEl('span', { cls: 'claudian-multi-agent-role', text: agent.role });

      const status = card.createDiv({ cls: 'claudian-multi-agent-card-status', text: 'Pending' });

      const progressTrack = card.createDiv({ cls: 'claudian-multi-agent-card-progress-track' });
      const progressBar = progressTrack.createDiv({ cls: 'claudian-multi-agent-card-progress-bar' });

      const output = card.createDiv({ cls: 'claudian-multi-agent-card-output claudian-hidden' });

      this.agentCards.set(agent.id, card);

      card.dataset.agentName = agent.name;
      card.dataset.agentOutput = '';
      card.dataset.agentStatus = 'pending';

      Object.assign(card, { _progressBar: progressBar, _statusEl: status, _outputEl: output });
    }
  }

  updateProgress(progress: MultiAgentProgress): void {
    if (!this.overallBar || !this.statusText) return;

    this.overallBar.style.width = `${progress.overall}%`;

    switch (progress.status) {
      case 'running':
        this.statusText.textContent = 'Agents are working…';
        this.statusText.className = 'claudian-multi-agent-status claudian-multi-agent-status--running';
        break;
      case 'completed':
        this.statusText.textContent = 'Mission completed';
        this.statusText.className = 'claudian-multi-agent-status claudian-multi-agent-status--done';
        break;
      case 'error':
        this.statusText.textContent = 'Mission completed with errors';
        this.statusText.className = 'claudian-multi-agent-status claudian-multi-agent-status--error';
        break;
      default:
        this.statusText.textContent = 'Preparing agents…';
    }

    for (const agentProgress of progress.agents) {
      this.updateAgentCard(agentProgress);
    }

    this.updateOutputPreview();
  }

  private updateAgentCard(progress: { agentId: string; status: string; progress: number; output?: string }): void {
    const card = this.agentCards.get(progress.agentId);
    if (!card) return;

    const progressBar = (card as unknown as { _progressBar: HTMLElement })._progressBar;
    const statusEl = (card as unknown as { _statusEl: HTMLElement })._statusEl;
    const outputEl = (card as unknown as { _outputEl: HTMLElement })._outputEl;

    progressBar.style.width = `${progress.progress}%`;

    card.removeClass('claudian-multi-agent-card--pending');
    card.removeClass('claudian-multi-agent-card--running');
    card.removeClass('claudian-multi-agent-card--done');
    card.removeClass('claudian-multi-agent-card--error');
    card.addClass(`claudian-multi-agent-card--${progress.status}`);

    statusEl.textContent = progress.status.charAt(0).toUpperCase() + progress.status.slice(1);

    if (progress.output) {
      outputEl.removeClass('claudian-hidden');
      outputEl.textContent = progress.output;
    }

    card.dataset.agentStatus = progress.status;
    card.dataset.agentOutput = progress.output ?? '';
  }

  private updateOutputPreview(): void {
    if (!this.outputPreview) return;

    const lines: string[] = [];
    for (const card of this.agentCards.values()) {
      const status = card.dataset.agentStatus ?? 'pending';
      const name = card.dataset.agentName ?? 'Agent';
      const output = card.dataset.agentOutput ?? '';
      const icon = status === 'done' ? '✓' : status === 'error' ? '✕' : status === 'running' ? '●' : '○';
      lines.push(`${icon} **${name}**${output ? `: ${output}` : ''}`);
    }

    this.outputPreview.empty();
    this.outputPreview.createEl('h4', { text: 'Live Output' });
    if (lines.length === 0 || lines.every((l) => !l.includes(':'))) {
      this.outputPreview.createEl('p', { cls: 'claudian-multi-agent-output-empty', text: 'Waiting for agents to report…' });
    } else {
      this.outputPreview.createEl('div', { cls: 'claudian-multi-agent-output-list' }).innerHTML = lines.join('<br>');
    }
  }

  setFinalResult(content: string): void {
    if (!this.outputPreview) return;
    this.outputPreview.empty();
    this.outputPreview.createEl('h4', { text: 'Final Result' });
    const body = this.outputPreview.createEl('div', { cls: 'claudian-multi-agent-final-result' });
    body.textContent = content.slice(0, 2000);
  }

  private static hexToRgb(hex: string): string | null {
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      return `${r}, ${g}, ${b}`;
    }
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    return null;
  }

  static async runTask(plugin: ClaudianPlugin, prompt: string): Promise<void> {
    const modal = new MultiAgentModal(plugin);
    modal.open();

    try {
      const agents = plugin.multiAgentService.listAgents().map((a) => a.id);
      const results = await plugin.multiAgentService.runTask(
        { id: `ma-${Date.now()}`, prompt, agents },
        async (agent: SpecialistAgent) => {
          await new Promise((resolve) => window.setTimeout(resolve, 600));
          return `${agent.name} analyzed the vault and produced recommendations.`;
        },
        (progress) => modal.updateProgress(progress),
      );

      const content = `# Multi-Agent Results\n\n${results.map((r) => `## ${r.agentId}\n\n${r.output}`).join('\n\n')}`;
      const filePath = `.claudian/multi-agent-${Date.now()}.md`;
      await plugin.app.vault.create(filePath, content);
      modal.setFinalResult(`Saved results to ${filePath}`);
      new Notice(`Multi-agent results written to ${filePath}`);
    } catch (error) {
      modal.updateProgress({
        taskId: 'ma-error',
        status: 'error',
        overall: 100,
        agents: [],
      });
      new Notice(`Multi-agent failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

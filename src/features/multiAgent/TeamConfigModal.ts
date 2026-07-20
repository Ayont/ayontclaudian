import { Modal, Notice, setIcon, setTooltip } from 'obsidian';

import {
  createEmptyTeamMember,
  getTeamModelOptions,
  MAX_TEAM_MEMBERS,
  suggestDefaultTeam,
  type TeamMemberConfig,
} from '../../core/intelligence/multiAgent/customTeam';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../main';
import { ModelSelectModal } from '../chat/ui/ModelSelectModal';

/**
 * Team editor behind the mission gear: assemble a custom agent team from ANY
 * provider/model combination (e.g. Codex + Fable + Opus). Each row is
 * Name + Rolle + Modell; the provider follows the model automatically.
 */
export class TeamConfigModal extends Modal {
  private members: TeamMemberConfig[];
  private useCustomTeam: boolean;
  private listEl: HTMLElement | null = null;

  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly onSaved: () => void,
  ) {
    super(plugin.app);
    this.members = (plugin.settings.multiAgentTeam ?? []).map((member) => ({ ...member }));
    this.useCustomTeam = plugin.settings.multiAgentUseCustomTeam ?? false;
    this.modalEl.addClass('claudian-team-config-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText('Agenten-Team konfigurieren');
    contentEl.createEl('p', {
      cls: 'claudian-team-config-subtitle',
      text: 'Stelle dein Team aus beliebigen Providern zusammen. Jedes Mitglied arbeitet parallel an der Mission; ein Koordinator führt die Ergebnisse zusammen.',
    });

    // Use-custom-team toggle
    const toggleRow = contentEl.createDiv({ cls: 'claudian-team-config-toggle-row' });
    const toggleLabel = toggleRow.createEl('label', { cls: 'claudian-team-config-toggle-label' });
    const toggleInput = toggleLabel.createEl('input', { type: 'checkbox' });
    toggleInput.checked = this.useCustomTeam;
    toggleLabel.createSpan({ text: 'Eigenes Team verwenden (statt aller Built-in-Spezialisten)' });
    toggleInput.addEventListener('change', () => {
      this.useCustomTeam = toggleInput.checked;
    });

    this.listEl = contentEl.createDiv({ cls: 'claudian-team-config-list' });
    this.renderMembers();

    // Row actions
    const actions = contentEl.createDiv({ cls: 'claudian-team-config-actions' });
    const addBtn = actions.createEl('button', { text: '+ Mitglied hinzufügen' });
    addBtn.addEventListener('click', () => {
      if (this.members.length >= MAX_TEAM_MEMBERS) {
        new Notice(`Maximal ${MAX_TEAM_MEMBERS} Team-Mitglieder.`);
        return;
      }
      this.members.push(createEmptyTeamMember(this.members));
      this.renderMembers();
    });

    const suggestBtn = actions.createEl('button', { text: 'Vorschlag: Codex · Fable · Opus' });
    suggestBtn.addEventListener('click', () => {
      const options = ProviderRegistry.getAggregatedModelOptions(
        this.plugin.settings as unknown as Record<string, unknown>,
      );
      const suggested = suggestDefaultTeam(options);
      if (suggested.length === 0) {
        new Notice('Keine passenden Modelle gefunden — bitte manuell wählen.');
        return;
      }
      this.members = suggested;
      this.useCustomTeam = true;
      toggleInput.checked = true;
      this.renderMembers();
    });

    // Footer
    const footer = contentEl.createDiv({ cls: 'claudian-team-config-footer' });
    const cancelBtn = footer.createEl('button', { text: 'Abbrechen' });
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = footer.createEl('button', { cls: 'mod-cta', text: 'Team speichern' });
    saveBtn.addEventListener('click', () => {
      void this.save();
    });
  }

  private renderMembers(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.members.length === 0) {
      this.listEl.createDiv({
        cls: 'claudian-team-config-empty',
        text: 'Noch keine Mitglieder. Füge welche hinzu oder nutze den Vorschlag.',
      });
      return;
    }

    this.members.forEach((member, index) => {
      const row = this.listEl!.createDiv({ cls: 'claudian-team-config-row' });

      const nameInput = row.createEl('input', {
        cls: 'claudian-team-config-name',
        attr: { placeholder: 'Name (z. B. Codex)', type: 'text' },
      });
      nameInput.value = member.name;
      nameInput.addEventListener('input', () => {
        this.members[index] = { ...this.members[index], name: nameInput.value };
      });

      const roleInput = row.createEl('input', {
        cls: 'claudian-team-config-role',
        attr: { placeholder: 'Rolle (z. B. Implementation)', type: 'text' },
      });
      roleInput.value = member.role;
      roleInput.addEventListener('input', () => {
        this.members[index] = { ...this.members[index], role: roleInput.value };
      });

      const modelBtn = row.createEl('button', { cls: 'claudian-team-config-model' });
      const modelLabel = (): string => {
        const current = this.members[index].model;
        if (!current) return 'Modell wählen…';
        const providerId = ProviderRegistry.resolveProviderForModel(
          current,
          this.plugin.settings as unknown as Record<string, unknown>,
        );
        return `${ProviderRegistry.getProviderDisplayName(providerId)} · ${current}`;
      };
      modelBtn.setText(modelLabel());
      modelBtn.addEventListener('click', () => {
        const options = getTeamModelOptions(
          ProviderRegistry.getAggregatedModelOptions(
            this.plugin.settings as unknown as Record<string, unknown>,
          ),
        );
        new ModelSelectModal(this.plugin.app, options, this.members[index].model, (value) => {
          this.members[index] = { ...this.members[index], model: value };
          modelBtn.setText(modelLabel());
        }).open();
      });

      const removeBtn = row.createEl('button', { cls: 'claudian-team-config-remove' });
      setIcon(removeBtn, 'trash-2');
      setTooltip(removeBtn, 'Mitglied entfernen');
      removeBtn.addEventListener('click', () => {
        this.members = this.members.filter((_, i) => i !== index);
        this.renderMembers();
      });
    });
  }

  private async save(): Promise<void> {
    this.plugin.settings.multiAgentTeam = this.members.map((member) => ({ ...member }));
    this.plugin.settings.multiAgentUseCustomTeam = this.useCustomTeam;
    await this.plugin.saveSettings();
    new Notice(
      this.useCustomTeam
        ? `Eigenes Team gespeichert (${this.members.filter((m) => m.name && m.model).length} Mitglieder).`
        : 'Team gespeichert — Missionen nutzen weiterhin die Built-in-Spezialisten.',
    );
    this.onSaved();
    this.close();
  }
}

import { Notice, Setting } from 'obsidian';

import { isCliInstalled } from '../../../core/install/cliDetection';
import {
  CLI_INSTALL_CATALOG,
  type CliInstallSpec,
  getPreferredInstallCommand,
} from '../../../core/install/cliInstallCatalog';
import { CliInstaller, type InstallProgress } from '../../../core/install/CliInstaller';
import type ClaudianPlugin from '../../../main';

/**
 * Settings section that lists every coding-agent CLI: shows whether it is
 * installed (missing ones are grayed out), and offers a one-click install with
 * a live percentage bar (or a docs link when no safe auto-install exists).
 * Mac/Windows/Linux commands come from {@link CLI_INSTALL_CATALOG}.
 */
export function renderCliInstallSection(container: HTMLElement, plugin: ClaudianPlugin): void {
  const section = container.createDiv({ cls: 'claudian-cli-install-section' });
  renderInto(section, plugin);
}

function renderInto(section: HTMLElement, plugin: ClaudianPlugin): void {
  section.empty();

  new Setting(section).setName('CLI-Installation').setHeading();
  section.createEl('p', {
    cls: 'claudian-cli-install-hint',
    text: 'Installiere die CLI eines Providers direkt hier. Fehlt eine CLI, ist sie ausgegraut — erst installieren, dann nutzen.',
  });

  for (const spec of Object.values(CLI_INSTALL_CATALOG)) {
    renderRow(section, plugin, spec, () => renderInto(section, plugin));
  }
}

function renderRow(
  section: HTMLElement,
  plugin: ClaudianPlugin,
  spec: CliInstallSpec,
  rerender: () => void,
): void {
  const installed = isCliInstalled(spec.id);
  const platform = process.platform;
  const preferred = getPreferredInstallCommand(spec.id, platform);

  const row = new Setting(section)
    .setName(spec.displayName)
    .setDesc(installed ? '✓ installiert' : 'nicht installiert');

  row.settingEl.toggleClass('claudian-cli-row', true);
  row.settingEl.toggleClass('is-installed', installed);
  row.settingEl.toggleClass('is-missing', !installed);

  // Docs link is always available.
  row.addExtraButton((button) => {
    button.setIcon('help-circle').setTooltip('Install-Anleitung öffnen');
    button.onClick(() => window.open(spec.docsUrl, '_blank'));
  });

  if (installed) {
    return;
  }

  if (!preferred) {
    // No safe auto-install command — point to the docs.
    row.addButton((button) => {
      button.setButtonText('Anleitung').onClick(() => window.open(spec.docsUrl, '_blank'));
    });
    return;
  }

  // Progress UI (created up front, shown while installing).
  const progressWrap = section.createDiv({ cls: 'claudian-cli-progress claudian-hidden' });
  const progressBar = progressWrap.createDiv({ cls: 'claudian-cli-progress-bar' });
  const progressText = progressWrap.createSpan({ cls: 'claudian-cli-progress-text' });

  row.addButton((button) => {
    button
      .setButtonText('Installieren')
      .setCta()
      .onClick(async () => {
        button.setDisabled(true);
        button.setButtonText('Installiert…');
        progressWrap.removeClass('claudian-hidden');
        progressWrap.removeClass('is-error');

        const installer = new CliInstaller();
        const onProgress = (progress: InstallProgress): void => {
          if (progress.percent !== null) {
            progressWrap.removeClass('is-indeterminate');
            progressBar.style.width = `${progress.percent}%`;
            progressText.setText(`${progress.percent}%`);
          } else {
            progressWrap.addClass('is-indeterminate');
            progressBar.style.width = '100%';
            progressText.setText(progress.phase === 'starting' ? 'Starte…' : 'Läuft…');
          }
        };

        const result = await installer.run(preferred.command, onProgress);

        if (result.ok) {
          progressBar.style.width = '100%';
          progressText.setText('Fertig ✓');
          new Notice(`${spec.displayName} installiert.`);
          // Re-detect and re-render so the row flips to "installiert".
          window.setTimeout(rerender, 600);
        } else {
          progressWrap.addClass('is-error');
          progressText.setText(result.error ?? 'Fehlgeschlagen');
          button.setDisabled(false);
          button.setButtonText('Erneut versuchen');
          new Notice(`Installation von ${spec.displayName} fehlgeschlagen.`, 6000);
        }
      });
  });

  // Keep the progress block visually attached under its row.
  row.settingEl.insertAdjacentElement('afterend', progressWrap);

  void plugin; // reserved for future per-host install paths
}

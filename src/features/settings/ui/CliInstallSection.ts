import { Notice, Setting } from 'obsidian';

import { normalizeCliAutoUpdateIntervalHours, parseCliAutoUpdateMode } from '../../../app/update/CliAutoUpdateService';
import { isCliInstalled } from '../../../core/install/cliDetection';
import {
  CLI_INSTALL_CATALOG,
  type CliInstallSpec,
  getPreferredInstallCommand,
} from '../../../core/install/cliInstallCatalog';
import { CliInstaller, type InstallProgress } from '../../../core/install/CliInstaller';
import { getCliUpdateSpec, getPreferredUpdateCommand } from '../../../core/install/cliUpdateCatalog';
import {
  checkProviderUpdate,
  type ProviderUpdateInfo,
} from '../../../core/install/CliUpdateService';
import type { ProviderId } from '../../../core/types/provider';
import type ClaudianPlugin from '../../../main';

type CliProgressVisual =
  | { mode: 'complete' | 'error' | 'indeterminate' }
  | { mode: 'determinate'; percent: number };

/** Keeps progress width in a themeable CSS property and static states in classes. */
export function applyCliProgressVisual(
  progressWrap: HTMLElement,
  progressBar: HTMLElement,
  visual: CliProgressVisual,
): void {
  progressWrap.classList.toggle('is-indeterminate', visual.mode === 'indeterminate');
  progressWrap.classList.toggle('is-complete', visual.mode === 'complete');
  progressWrap.classList.toggle('is-error', visual.mode === 'error');

  if (visual.mode === 'determinate') {
    const percent = Math.min(100, Math.max(0, visual.percent));
    progressBar.style.setProperty('--claudian-cli-progress-width', `${percent}%`);
    return;
  }
  progressBar.style.removeProperty('--claudian-cli-progress-width');
}

/**
 * Authoritative "is this CLI usable" check for the install list. Prefers the
 * provider's own runtime resolver (so detection matches what actually launches,
 * including a user-configured `cliPath` and modern/legacy binary names), and
 * falls back to PATH-based catalog detection when no resolver is registered
 * (e.g. the provider is disabled).
 */
function isProviderCliPresent(plugin: ClaudianPlugin, providerId: string): boolean {
  try {
    if (plugin.getResolvedProviderCliPath(providerId as ProviderId)) {
      return true;
    }
  } catch {
    // Resolver not registered yet — fall through to catalog detection.
  }
  return isCliInstalled(providerId);
}

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

  renderAutoUpdateControls(section, plugin);

  for (const spec of Object.values(CLI_INSTALL_CATALOG)) {
    renderRow(section, plugin, spec, () => renderInto(section, plugin));
  }
}

function renderAutoUpdateControls(section: HTMLElement, plugin: ClaudianPlugin): void {
  new Setting(section).setName('Automatische Updates').setHeading();

  const modeSetting = new Setting(section)
    .setName('Aktualisierungsmodus')
    .setDesc(
      '„Automatisch“ bringt CLI-Updates im Hintergrund von selbst an. „Nur melden“ zeigt sie im Chat an, „Aus“ deaktiviert die Prüfung.',
    )
    .addDropdown((dropdown) => {
      dropdown
        .addOption('auto', 'Automatisch im Hintergrund')
        .addOption('notify', 'Nur melden')
        .addOption('off', 'Aus')
        .setValue(parseCliAutoUpdateMode(plugin.settings.cliAutoUpdateMode))
        .onChange(async (value) => {
          plugin.settings.cliAutoUpdateMode = parseCliAutoUpdateMode(value);
          await plugin.saveSettings();
          plugin.getCliAutoUpdater().schedule();
        });
    });
  modeSetting.settingEl.addClass('claudian-cli-auto-mode');

  const intervalSetting = new Setting(section)
    .setName('Prüfintervall')
    .setDesc('Wie oft im Hintergrund nach neuen CLI-Versionen gesucht wird.')
    .addDropdown((dropdown) => {
      for (const hours of [6, 12, 24, 48, 168]) {
        dropdown.addOption(String(hours), hours === 168 ? '1 Woche' : `${hours} Stunden`);
      }
      dropdown
        .setValue(String(normalizeCliAutoUpdateIntervalHours(plugin.settings.cliAutoUpdateIntervalHours)))
        .onChange(async (value) => {
          plugin.settings.cliAutoUpdateIntervalHours = normalizeCliAutoUpdateIntervalHours(Number(value));
          await plugin.saveSettings();
          plugin.getCliAutoUpdater().schedule();
        });
    });
  intervalSetting.settingEl.addClass('claudian-cli-auto-interval');

  const lastRunAt = plugin.settings.cliAutoUpdateLastRunAt;
  if (lastRunAt) {
    const mode = parseCliAutoUpdateMode(plugin.settings.cliAutoUpdateMode);
    new Setting(section)
      .setName('Letzte Prüfung')
      .setDesc(`Vor ${formatAge(lastRunAt)} · Modus: ${mode === 'auto' ? 'Automatisch' : mode === 'notify' ? 'Nur melden' : 'Aus'}`);
  }
}

function formatAge(atMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - atMs) / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ${minutes % 60} min`;
  }
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function renderRow(
  section: HTMLElement,
  plugin: ClaudianPlugin,
  spec: CliInstallSpec,
  rerender: () => void,
): void {
  const installed = isProviderCliPresent(plugin, spec.id);
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
    const updateCommand = getPreferredUpdateCommand(spec.id, platform);
    const updateSpec = getCliUpdateSpec(spec.id);
    const canDetectLatest = Boolean(updateSpec?.npmPackage || updateSpec?.pypiPackage);
    if (updateCommand) {
      const progressWrap = section.createDiv({ cls: 'claudian-cli-progress claudian-hidden' });
      const progressBar = progressWrap.createDiv({ cls: 'claudian-cli-progress-bar' });
      const progressText = progressWrap.createSpan({ cls: 'claudian-cli-progress-text' });
      row.settingEl.insertAdjacentElement('afterend', progressWrap);

      row.addButton((button) => {
        if (canDetectLatest) {
          button.setButtonText('Prüfe…').setDisabled(true);
        } else {
          button.setButtonText('Aktualisieren');
        }
        button.onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Aktualisiert…');
          progressWrap.removeClass('claudian-hidden');
          applyCliProgressVisual(progressWrap, progressBar, { mode: 'determinate', percent: 0 });
          const info = await checkProviderUpdate(spec.id, plugin.settings as unknown as Record<string, unknown>);
          const payload = {
            providerId: spec.id,
            displayName: spec.displayName,
            currentVersion: info?.currentVersion ?? null,
            latestVersion: info?.latestVersion ?? null,
            updateAvailable: info?.updateAvailable ?? false,
            updateCommand: info?.updateCommand ?? updateCommand,
          };
          const unsub = plugin.onUpdateSessionChange((state) => {
            const item = state.items.find((entry) => entry.id === `cli:${spec.id}`);
            if (!item) {
              return;
            }
            if (item.percent !== null) {
              applyCliProgressVisual(progressWrap, progressBar, {
                mode: 'determinate',
                percent: item.percent,
              });
              progressText.setText(item.logLines.at(-1) ?? `${item.percent}%`);
            } else {
              applyCliProgressVisual(progressWrap, progressBar, { mode: 'indeterminate' });
              progressText.setText(item.logLines.at(-1) ?? 'Läuft…');
            }
          });
          try {
            await plugin.startCliUpdate(payload);
            const done = plugin.getUpdateSession().items.find((entry) => entry.id === `cli:${spec.id}`);
            if (done?.status === 'error') {
              applyCliProgressVisual(progressWrap, progressBar, { mode: 'error' });
              progressText.setText(done.error ?? 'Fehlgeschlagen');
              button.setDisabled(false);
              button.setButtonText(canDetectLatest ? 'Update' : 'Aktualisieren');
              return;
            }
            applyCliProgressVisual(progressWrap, progressBar, { mode: 'complete' });
            progressText.setText('Fertig ✓');
            window.setTimeout(rerender, 400);
          } finally {
            unsub();
          }
        });
        void checkProviderUpdate(spec.id, plugin.settings as unknown as Record<string, unknown>).then((info) => {
          applyInstalledVersion(row, info);
          if (!canDetectLatest) {
            return;
          }
          if (info?.updateAvailable) {
            button.setDisabled(false);
            button.setButtonText('Update');
            button.setCta();
            return;
          }
          if (info) {
            button.buttonEl.addClass('claudian-hidden');
            return;
          }
          button.setDisabled(false);
          button.setButtonText('Aktualisieren');
        });
      });
      return;
    }
    void checkProviderUpdate(spec.id, plugin.settings as unknown as Record<string, unknown>).then((info) => {
      applyInstalledVersion(row, info);
    });
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
        applyCliProgressVisual(progressWrap, progressBar, { mode: 'determinate', percent: 0 });

        const installer = new CliInstaller();
        const onProgress = (progress: InstallProgress): void => {
          if (progress.percent !== null) {
            applyCliProgressVisual(progressWrap, progressBar, {
              mode: 'determinate',
              percent: progress.percent,
            });
            progressText.setText(`${progress.percent}%`);
          } else {
            applyCliProgressVisual(progressWrap, progressBar, { mode: 'indeterminate' });
            progressText.setText(progress.phase === 'starting' ? 'Starte…' : 'Läuft…');
          }
        };

        const result = await installer.run(preferred.command, onProgress);

        if (result.ok) {
          applyCliProgressVisual(progressWrap, progressBar, { mode: 'complete' });
          progressText.setText('Fertig ✓');
          new Notice(`${spec.displayName} installiert.`);
          // Re-detect and re-render so the row flips to "installiert".
          window.setTimeout(rerender, 600);
        } else {
          applyCliProgressVisual(progressWrap, progressBar, { mode: 'error' });
          progressText.setText(result.error ?? 'Fehlgeschlagen');
          button.setDisabled(false);
          button.setButtonText('Erneut versuchen');
          new Notice(`Installation von ${spec.displayName} fehlgeschlagen.`, 6000);
        }
      });
  });

  // Keep the progress block visually attached under its row.
  row.settingEl.insertAdjacentElement('afterend', progressWrap);
}

export function describeProviderInstallStatus(
  info: ProviderUpdateInfo | null,
): { desc: string; highlightUpdate: boolean } | null {
  if (!info) {
    return null;
  }
  if (info.updateAvailable && info.latestVersion) {
    return {
      desc: `Update ${info.latestVersion} (aktuell ${info.currentVersion ?? '?'})`,
      highlightUpdate: true,
    };
  }
  if (info.currentVersion) {
    return { desc: `✓ installiert · ${info.currentVersion}`, highlightUpdate: false };
  }
  return { desc: '✓ installiert', highlightUpdate: false };
}

function applyInstalledVersion(
  row: Setting,
  info: ProviderUpdateInfo | null,
): void {
  const status = describeProviderInstallStatus(info);
  if (!status) {
    return;
  }
  row.setDesc(status.desc);
  row.settingEl.toggleClass('is-update', status.highlightUpdate);
}

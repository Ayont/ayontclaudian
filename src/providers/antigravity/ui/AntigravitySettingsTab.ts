import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Notice, Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetAntigravityWorkspaceServices } from '../app/AntigravityWorkspaceServices';
import {
  ANTIGRAVITY_PROVIDER_ID,
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';
import { AgyChangelogModal } from './AgyChangelogModal';

function validateCliPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath)) {
    return 'Path does not exist';
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return 'Path must point to a file';
  }
  return null;
}

export const antigravitySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getAntigravityProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetAntigravityWorkspaceServices();

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Antigravity')
      .setDesc('Launch Google Antigravity (`agy --print`) as a provider.')
      .addToggle((toggle) =>
        toggle
          .setValue(settings.enabled)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          }),
      );

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });
    const cliPathsByHost = { ...settings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const updateValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validateCliPath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-hidden', false);
        inputEl?.toggleClass('claudian-input-error', true);
        return false;
      }
      validationEl.toggleClass('claudian-hidden', true);
      inputEl?.toggleClass('claudian-input-error', false);
      return true;
    };

    const persistCliPath = async (value: string): Promise<void> => {
      if (!updateValidation(value, cliPathInputEl ?? undefined)) {
        return;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateAntigravityProviderSettings(settingsBag, {
        cliPathsByHost: { ...cliPathsByHost },
      });
      workspace?.cliResolver?.reset();
      await context.plugin.saveSettings();
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName('CLI path')
      .setDesc('Optional absolute path to the `agy` binary for this computer. Leave empty to use `agy` from PATH.')
      .addText((text) => {
        const currentValue = settings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\.local\\bin\\agy.exe'
            : '/Users/you/.local/bin/agy')
          .setValue(currentValue)
          .onChange((value) => {
            void persistCliPath(value);
          });
        cliPathInputEl = text.inputEl;
        updateValidation(currentValue, text.inputEl);
      });

    new Setting(container).setName('Runtime').setHeading();

    new Setting(container)
      .setName('Workspace scope')
      .setDesc(
        'Vault only confines Antigravity to your vault directory. Allow home additionally lets it read and write anywhere under your home folder.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('vault-only', 'Vault only')
          .addOption('allow-home', 'Allow home directory')
          .setValue(settings.workspaceScope)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, {
              workspaceScope: value === 'allow-home' ? 'allow-home' : 'vault-only',
            });
            await context.plugin.saveSettings();
          }),
      );

    new Setting(container)
      .setName('Permission mode')
      .setDesc(
        'YOLO passes `--dangerously-skip-permissions` so the non-interactive `--print` run never stalls on a prompt (recommended default). Sandbox runs Antigravity inside its OS sandbox (`--sandbox`) without skipping permissions, for an extra isolation layer. You can also flip this from the chat toolbar.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('yolo', 'YOLO (skip permissions)')
          .addOption('sandbox', 'Sandbox (--sandbox)')
          .setValue(settings.permissionMode)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, {
              permissionMode: value === 'sandbox' ? 'sandbox' : 'yolo',
            });
            await context.plugin.saveSettings();
          }),
      );

    new Setting(container)
      .setName('Print timeout')
      .setDesc(
        'Optional time limit per turn passed as `--print-timeout` (e.g. `10m`, `90s`). Leave empty for no limit.',
      )
      .addText((text) =>
        text
          .setPlaceholder('10m')
          .setValue(settings.printTimeout)
          .onChange(async (value) => {
            updateAntigravityProviderSettings(settingsBag, { printTimeout: value.trim() });
            await context.plugin.saveSettings();
          }),
      );

    // Read the active account from Google Accounts
    let activeEmail: string | null = null;
    try {
      const homedir = os.homedir();
      const accountsPath = path.join(homedir, '.gemini', 'google_accounts.json');
      if (fs.existsSync(accountsPath)) {
        const raw = fs.readFileSync(accountsPath, 'utf8');
        const parsed = JSON.parse(raw);
        activeEmail = parsed.active || null;
      }
    } catch {
      // Ignore
    }

    new Setting(container).setName('Authentication & Version').setHeading();

    new Setting(container)
      .setName('Google Account')
      .setDesc(activeEmail ? `🟢 Authenticated as ${activeEmail}` : '⚠️ Not authenticated. Run `agy` in your terminal to sign in.');

    const versionSetting = new Setting(container)
      .setName('CLI Version')
      .setDesc('Checking...');

    const resolvedCliPath = context.plugin.getResolvedProviderCliPath(ANTIGRAVITY_PROVIDER_ID) || 'agy';
    exec(`"${resolvedCliPath}" --version`, (err, stdout, stderr) => {
      if (err) {
        versionSetting.setDesc('Not installed or not found on PATH');
      } else {
        versionSetting.setDesc(stdout.trim() || stderr.trim() || 'Unknown');
      }
    });

    new Setting(container).setName('CLI Management').setHeading();

    new Setting(container)
      .setName('CLI Actions')
      .setDesc('Perform updates, view release notes, or import extensions.')
      .addButton((btn) =>
        btn
          .setButtonText('Update CLI')
          .setTooltip('Update agy CLI to the latest version')
          .onClick(() => {
            btn.setButtonText('Updating...');
            btn.setDisabled(true);
            exec(`"${resolvedCliPath}" update`, (err, stdout, stderr) => {
              btn.setDisabled(false);
              btn.setButtonText('Update CLI');
              if (err) {
                new Notice(`Failed to update CLI: ${stderr.trim() || err.message}`);
              } else {
                new Notice(`Antigravity CLI updated successfully!\n${stdout.trim()}`);
                exec(`"${resolvedCliPath}" --version`, (err2, stdout2) => {
                  if (!err2) versionSetting.setDesc(stdout2.trim());
                });
              }
            });
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('View Changelog')
          .setTooltip('Show recent CLI release notes')
          .onClick(() => {
            btn.setButtonText('Loading...');
            btn.setDisabled(true);
            exec(`"${resolvedCliPath}" changelog`, (err, stdout, stderr) => {
              btn.setDisabled(false);
              btn.setButtonText('View Changelog');
              if (err) {
                new Notice(`Failed to fetch changelog: ${stderr.trim() || err.message}`);
              } else {
                new AgyChangelogModal(context.plugin.app, stdout).open();
              }
            });
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Import Plugins')
          .setTooltip('Import plugins from Claude Code')
          .onClick(() => {
            btn.setButtonText('Importing...');
            btn.setDisabled(true);
            exec(`"${resolvedCliPath}" plugin import claude`, (err, stdout, stderr) => {
              btn.setDisabled(false);
              btn.setButtonText('Import Plugins');
              if (err) {
                new Notice(`Import failed: ${stderr.trim() || err.message}`);
              } else {
                new Notice(stdout.trim() || 'Plugins imported successfully.');
              }
            });
          }),
      );

    renderEnvironmentSettingsSection({
      container,
      desc: 'Extra environment variables passed only to Antigravity (`ANTIGRAVITY_*`, `GEMINI_*`).',
      heading: 'Environment',
      name: 'Antigravity environment variables',
      placeholder: 'GEMINI_API_KEY=...\nANTIGRAVITY_LOG=debug',
      plugin: context.plugin,
      scope: `provider:${ANTIGRAVITY_PROVIDER_ID}`,
    });
  },
};

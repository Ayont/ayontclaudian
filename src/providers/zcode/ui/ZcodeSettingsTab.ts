import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getHostnameKey } from '../../../utils/env';
import { ZcodeCliResolver } from '../runtime/ZcodeCliResolver';
import {
  detectLocalZcodeCredentials,
  getZcodeProviderSettings,
  updateZcodeProviderSettings,
  ZCODE_PROVIDER_ID,
  type ZcodePermissionMode,
  type ZcodeReasoningEffort,
} from '../settings';

export const zcodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const settings = getZcodeProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const cliResolver = new ZcodeCliResolver();
    const resolvedCli = cliResolver.resolve(settings);
    const detected = detectLocalZcodeCredentials();

    // --- Setup ---
    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('ZCode (Z.ai) aktivieren')
      .setDesc('ZCode / Z.ai Coding Plan als Provider aktivieren.')
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          updateZcodeProviderSettings(settingsBag, (curr) => ({ ...curr, enabled: value }));
          await context.plugin.saveSettings();
          context.refreshModelSelectors();
        }),
      );

    // --- API Key ---
    const apiKeyDesc = detected.apiKey
      ? 'Dein Z.ai API-Schlüssel (automatisch aus ~/.zcode erkannt, falls leer gelassen).'
      : 'Dein Z.ai API-Schlüssel (z. B. aus Z.ai oder ~/.zcode/v2/config.json).';

    new Setting(container)
      .setName('Z.ai API Key')
      .setDesc(apiKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder(detected.apiKey ? 'Automatisch erkannt (aktiv)' : 'a2b7b326...')
          .setValue(settings.apiKey)
          .onChange(async (val) => {
            updateZcodeProviderSettings(settingsBag, (curr) => ({ ...curr, apiKey: val.trim() }));
            await context.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    // --- Base URL ---
    new Setting(container)
      .setName('API Base URL')
      .setDesc('Anthropic-kompatibler Endpunkt von Z.ai (Standard: https://api.z.ai/api/anthropic).')
      .addText((text) =>
        text
          .setPlaceholder('https://api.z.ai/api/anthropic')
          .setValue(settings.baseURL)
          .onChange(async (val) => {
            updateZcodeProviderSettings(settingsBag, (curr) => ({
              ...curr,
              baseURL: val.trim() || 'https://api.z.ai/api/anthropic',
            }));
            await context.plugin.saveSettings();
          }),
      );

    // --- CLI Path ---
    const cliStatusDesc = resolvedCli
      ? `Gefundene ZCode CLI: ${resolvedCli}`
      : 'Pfad zur lokalen zcode CLI (z. B. /Users/ayont/.local/bin/zcode).';

    new Setting(container)
      .setName('ZCode CLI Pfad')
      .setDesc(cliStatusDesc)
      .addText((text) =>
        text
          .setPlaceholder('zcode')
          .setValue(settings.cliPathsByHost[hostnameKey] ?? settings.cliPath)
          .onChange(async (val) => {
            const trimmed = val.trim();
            updateZcodeProviderSettings(settingsBag, (curr) => ({
              ...curr,
              cliPath: trimmed || 'zcode',
              cliPathsByHost: { ...curr.cliPathsByHost, [hostnameKey]: trimmed },
            }));
            await context.plugin.saveSettings();
          }),
      );

    // --- Reasoning Effort ---
    new Setting(container)
      .setName('Standard Reasoning Effort')
      .setDesc('Denkzeit-Budget für GLM-5.3 (low = 4K, high = 16K, max = 32K Tokens).')
      .addDropdown((drop) =>
        drop
          .addOption('max', 'Max (32K Tokens)')
          .addOption('high', 'High (16K Tokens)')
          .addOption('low', 'Low (4K Tokens)')
          .addOption('off', 'Aus')
          .setValue(settings.reasoningEffort)
          .onChange(async (val) => {
            updateZcodeProviderSettings(settingsBag, (curr) => ({
              ...curr,
              reasoningEffort: val as ZcodeReasoningEffort,
            }));
            await context.plugin.saveSettings();
          }),
      );

    // --- Permission Mode ---
    new Setting(container)
      .setName('Standard Permission Mode')
      .setDesc('Sicherheitsmodus: Safe (Bestätigung), YOLO (automatisch), oder Plan.')
      .addDropdown((drop) =>
        drop
          .addOption('normal', 'Safe (Bestätigen)')
          .addOption('yolo', 'YOLO (Auto-Execute)')
          .addOption('plan', 'Plan (Nur Planen)')
          .setValue(settings.permissionMode)
          .onChange(async (val) => {
            updateZcodeProviderSettings(settingsBag, (curr) => ({
              ...curr,
              permissionMode: val as ZcodePermissionMode,
            }));
            await context.plugin.saveSettings();
          }),
      );

    // --- Custom Models ---
    new Setting(container)
      .setName('Zusätzliche Modelle')
      .setDesc('Zeilengetrennte Liste weiterer Modelle (z. B. "glm-custom:Mein Custom Modell").')
      .addTextArea((area) =>
        area
          .setPlaceholder('glm-custom:Mein Modell')
          .setValue(settings.customModels)
          .onChange(async (val) => {
            updateZcodeProviderSettings(settingsBag, (curr) => ({ ...curr, customModels: val }));
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          }),
      );

    // --- Environment Variables ---
    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: `provider:${ZCODE_PROVIDER_ID}`,
      name: 'Umgebungsvariablen',
      desc: 'Zusätzliche Umgebungsvariablen für ZCode / Z.ai.',
      placeholder: 'ZAI_API_KEY=...',
    });
  },
};

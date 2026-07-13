import { Notice, Setting } from 'obsidian';

import { areVoiceDependenciesReady, ensureVoiceDependencies } from '../../../core/audio/voiceSetup';
import type ClaudianPlugin from '../../../main';

/**
 * Enumerates audio input devices. Requests microphone permission first
 * so the browser fills in human-readable device labels.
 */
async function enumerateAudioDevices(): Promise<MediaDeviceInfo[]> {
  try {
    // Request permission to get labels (browsers hide labels without permission)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Permission denied — we can still list device IDs, just no labels
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

const WHISPER_MODELS = {
  tiny: { name: 'Tiny (~75 MB)', desc: 'Schnellstes Modell, niedrigste Genauigkeit', speed: '~10× Echtzeit' },
  base: { name: 'Base (~142 MB)', desc: 'Gute Balance aus Speed und Genauigkeit (Standard)', speed: '~7× Echtzeit' },
  small: { name: 'Small (~466 MB)', desc: 'Deutlich bessere Genauigkeit, langsamer', speed: '~4× Echtzeit' },
  medium: { name: 'Medium (~1.5 GB)', desc: 'Hohe Genauigkeit, braucht mehr RAM', speed: '~2× Echtzeit' },
  large: { name: 'Large (~3 GB)', desc: 'Beste Genauigkeit, braucht viel RAM und Zeit', speed: '~1× Echtzeit' },
} as const;

const VOICE_LANGUAGES = [
  { value: 'auto', label: 'Automatischerkennung' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'fr', label: 'Französisch' },
  { value: 'es', label: 'Spanisch' },
  { value: 'it', label: 'Italienisch' },
  { value: 'pt', label: 'Portugiesisch' },
  { value: 'nl', label: 'Niederländisch' },
  { value: 'ja', label: 'Japanisch' },
  { value: 'zh', label: 'Chinesisch' },
  { value: 'ko', label: 'Koreanisch' },
  { value: 'ru', label: 'Russisch' },
  { value: 'ar', label: 'Arabisch' },
  { value: 'hi', label: 'Hindi' },
  { value: 'tr', label: 'Türkisch' },
  { value: 'pl', label: 'Polnisch' },
  { value: 'sv', label: 'Schwedisch' },
  { value: 'da', label: 'Dänisch' },
  { value: 'fi', label: 'Finnisch' },
  { value: 'no', label: 'Norwegisch' },
];

function getVoiceSettings(plugin: ClaudianPlugin) {
  if (!plugin.settings.voiceSettings) {
    plugin.settings.voiceSettings = { enabled: true, language: 'auto', model: 'base', autoSetup: true, microphoneId: '', preferFastBackend: true };
  }
  return plugin.settings.voiceSettings;
}

/**
 * Renders the Spracheingabe (Voice Input) settings section.
 * Shows install status, model picker, language picker, and one-click setup.
 */
export function renderVoiceSettingsSection(container: HTMLElement, plugin: ClaudianPlugin): void {
  const section = container.createDiv({ cls: 'claudian-voice-settings-section' });
  renderInto(section, plugin);
}

function renderInto(section: HTMLElement, plugin: ClaudianPlugin): void {
  section.empty();
  const vs = getVoiceSettings(plugin);

  new Setting(section).setName('Spracheingabe').setHeading();
  section.createEl('p', {
    cls: 'claudian-voice-settings-hint',
    text: 'Lokale Spracherkennung über whisper-cpp — keine Cloud, kein Netzwerk. Erstmalige Einrichtung installiert ffmpeg, whisper-cpp und das Modell automatisch via Homebrew.',
  });

  // ── Enable / Disable ──────────────────────────────────────────────
  new Setting(section)
    .setName('Spracheingabe aktiviert')
    .setDesc('Mikrofon-Button im Composer anzeigen')
    .addToggle((toggle) =>
      toggle
        .setValue(vs.enabled)
        .onChange(async (value) => {
          vs.enabled = value;
          await plugin.saveSettings();
        }),
    );

  // ── Auto-Setup ────────────────────────────────────────────────────
  new Setting(section)
    .setName('Automatische Einrichtung')
    .setDesc('Beim ersten Klick fehlende Abhängigkeiten automatisch installieren (ffmpeg, whisper-cpp, Modell)')
    .addToggle((toggle) =>
      toggle
        .setValue(vs.autoSetup)
        .onChange(async (value) => {
          vs.autoSetup = value;
          await plugin.saveSettings();
        }),
    );

  // ── Model Picker ──────────────────────────────────────────────────
  new Setting(section)
    .setName('Whisper-Modell')
    .setDesc('Größere Modelle sind genauer, aber langsamer und brauchen mehr RAM')
    .addDropdown((dropdown) => {
      for (const [key, info] of Object.entries(WHISPER_MODELS)) {
        dropdown.addOption(key, `${info.name} — ${info.speed}`);
      }
      dropdown
        .setValue(vs.model)
        .onChange(async (value) => {
          vs.model = value as typeof vs.model;
          await plugin.saveSettings();
        });
    });

  // ── Model info ────────────────────────────────────────────────────
  const modelInfo = WHISPER_MODELS[vs.model];
  section.createEl('p', {
    cls: 'claudian-voice-model-info',
    text: `${modelInfo.desc}. Geschwindigkeit: ${modelInfo.speed}. Modell-Datei: ~/.cache/whisper-cpp/ggml-${vs.model}.bin`,
  });

  // ── Fast Backend Toggle ───────────────────────────────────────────
  if (process.platform === 'darwin') {
    new Setting(section)
      .setName('Schnelles Backend bevorzugen')
      .setDesc('mlx-whisper auf Apple Silicon nutzen (deutlich schneller als whisper-cli)')
      .addToggle((toggle) =>
        toggle
          .setValue(vs.preferFastBackend)
          .onChange(async (value) => {
            vs.preferFastBackend = value;
            await plugin.saveSettings();
          }),
      );
  }

  // ── Active Backend ────────────────────────────────────────────────
  const backendStatusEl = section.createEl('p', {
    cls: 'claudian-voice-model-info',
    text: 'Prüfe aktives Backend…',
  });

  void (async () => {
    const { VoiceBackendResolver } = await import('../../../core/audio/VoiceBackendResolver');
    const resolver = new VoiceBackendResolver(vs.preferFastBackend);
    const backend = await resolver.resolve();
    backendStatusEl.textContent = backend
      ? `Aktives Backend: ${backend.displayName}`
      : 'Aktives Backend: nicht verfügbar';
  })();

  // ── Language Picker ───────────────────────────────────────────────
  new Setting(section)
    .setName('Sprache')
    .setDesc('Spracherkennung oder feste Sprache (auto = automatische Erkennung)')
    .addDropdown((dropdown) => {
      for (const lang of VOICE_LANGUAGES) {
        dropdown.addOption(lang.value, lang.label);
      }
      dropdown
        .setValue(vs.language)
        .onChange(async (value) => {
          vs.language = value;
          await plugin.saveSettings();
        });
    });

  // ── Microphone Picker ────────────────────────────────────────────
  const micSetting = new Setting(section)
    .setName('Mikrofon')
    .setDesc('Audioeingabe-Gerät auswählen (Systemstandard, wenn leer)')
    .addDropdown((dropdown) => {
      dropdown.addOption('', '— Systemstandard —');
      dropdown.setValue(vs.microphoneId);
      dropdown.onChange(async (value) => {
        vs.microphoneId = value;
        await plugin.saveSettings();
      });
      // Populate devices asynchronously
      void enumerateAudioDevices().then((devices) => {
        dropdown.selectEl.textContent = '';
        dropdown.addOption('', '— Systemstandard —');
        for (const device of devices) {
          dropdown.addOption(device.deviceId, device.label || `Mikrofon (${device.deviceId.slice(0, 8)}…)`);
        }
        dropdown.setValue(vs.microphoneId);
      });
    });

  // Hint for microphone permission
  const micHintEl = section.createEl('p', {
    cls: 'claudian-voice-model-info',
    text: 'Erlaube den Mikrofon-Zugriff, wenn Obsidian danach fragt. Geräte erscheinen nach der ersten Berechtigung.',
  });

  // ── Install Status + Manual Install ───────────────────────────────
  const statusDiv = section.createDiv({ cls: 'claudian-voice-install-status' });

  async function checkStatus() {
    statusDiv.empty();
    statusDiv.createEl('p', { text: 'Überprüfe Abhängigkeiten…', cls: 'claudian-voice-checking' });

    const ready = await areVoiceDependenciesReady(vs.model);

    statusDiv.empty();
    if (ready) {
      statusDiv.createEl('p', {
        text: `✓ Alle Abhängigkeiten vorhanden (ffmpeg, whisper-cpp, Modell: ggml-${vs.model}).`,
        cls: 'claudian-voice-status-ok',
      });
    } else {
      statusDiv.createEl('p', {
        text: '✗ Einige Abhängigkeiten fehlen.',
        cls: 'claudian-voice-status-missing',
      });

      new Setting(statusDiv)
        .setName('Jetzt einrichten')
        .setDesc(`Installiert ffmpeg, whisper-cpp und das ${vs.model}-Modell via Homebrew. Dauert 1–3 Minuten beim ersten Mal.`)
        .addButton((btn) =>
          btn
            .setButtonText('Alle installieren')
            .setCta()
            .onClick(async () => {
              btn.setButtonText('Installiere…').setDisabled(true);
              try {
                const result = await ensureVoiceDependencies(vs.model);
                if (result.ffmpegOk && result.whisperOk && result.modelOk) {
                  new Notice('Spracheingabe vollständig eingerichtet!');
                } else {
                  const missing: string[] = [];
                  if (!result.ffmpegOk) missing.push('ffmpeg');
                  if (!result.whisperOk) missing.push('whisper-cpp');
                  if (!result.modelOk) missing.push(`Modell (${vs.model})`);
                  new Notice(`Fehlend: ${missing.join(', ')}. Bitte manuell installieren.`, 8000);
                }
              } catch (error) {
                new Notice(`Installation fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`, 8000);
              }
              btn.setButtonText('Alle installieren').setDisabled(false);
              await checkStatus();
            }),
        );
    }
  }

  void checkStatus();
}

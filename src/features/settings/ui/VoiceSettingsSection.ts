import { Notice, Setting } from 'obsidian';

import { DEFAULT_CLOUD_BASE_URL, DEFAULT_CLOUD_MODEL } from '../../../core/audio/CloudWhisperTranscriber';
import { isLiveSpeechSupported } from '../../../core/audio/liveSpeech';
import { resolveVoiceCloudConfig } from '../../../core/audio/resolveVoiceCloudConfig';
import { areVoiceDependenciesReady, diagnoseVoiceSetup, ensureVoiceDependencies } from '../../../core/audio/voiceSetup';
import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
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
    plugin.settings.voiceSettings = {
      enabled: true,
      language: 'auto',
      model: 'base',
      autoSetup: true,
      microphoneId: '',
      preferFastBackend: true,
      cloudEnabled: false,
      cloudBaseUrl: '',
      cloudApiKey: '',
      cloudModel: '',
    };
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
    text: 'Sprache erscheint live im Composer, während du redest. Schnellster Weg: System-Diktat (kostenlos, kein Key). Fallback: Groq Whisper (kostenloser Key) oder Mistral Voxtral über deinen Vibe-Key — Audio geht dann in die Cloud. Lokal bleibt whisper-cpp als letzter Fallback.',
  });

  // ── Apple Silicon architecture warning ─────────────────────────────
  // A whisper-cli/ffmpeg resolved from /usr/local (Intel Homebrew) runs
  // translated under Rosetta on Apple Silicon — several times slower, with no
  // visible error. Surface this explicitly since it otherwise looks like
  // "voice input is just slow" with no actionable cause.
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const archWarningEl = section.createEl('p', { cls: 'claudian-voice-model-info' });
    void diagnoseVoiceSetup().then((diag) => {
      if (diag.whisperCliNative && diag.ffmpegNative) {
        archWarningEl.remove();
        return;
      }
      const wrong = [
        !diag.whisperCliNative ? 'whisper-cli' : null,
        !diag.ffmpegNative ? 'ffmpeg' : null,
      ].filter(Boolean).join(' und ');
      archWarningEl.addClass('claudian-voice-status-missing');
      archWarningEl.setText(
        `⚠ ${wrong} läuft aktuell unter Rosetta (Intel-Build via /usr/local) statt nativ auf Apple Silicon — mehrfach langsamer. Schnellere Wege: das Cloud-Backend (unten) oder mlx-whisper nativ — „Alle installieren" richtet mlx-whisper in einer eigenen Umgebung ein, auch ohne natives Homebrew.`,
      );
    });
  }

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
      .setName('mlx-whisper als Alternativ-Backend')
      .setDesc('Zusätzlich mlx-whisper auf Apple Silicon anbieten. Meist unnötig: der warmgehaltene whisper-server ist bereits die schnellste Option und wird immer bevorzugt, wenn verfügbar.')
      .addToggle((toggle) =>
        toggle
          .setValue(vs.preferFastBackend)
          .onChange(async (value) => {
            vs.preferFastBackend = value;
            await plugin.saveSettings();
          }),
      );
  }

  // ── Cloud backend (fastest, opt-in) ────────────────────────────────
  new Setting(section).setName('Cloud-Backend').setHeading();
  section.createEl('p', {
    cls: 'claudian-voice-settings-hint',
    text: 'Groq (console.groq.com, kostenlos, whisper-large-v3-turbo) oder Mistral Voxtral (dein bestehender Vibe-Key / MISTRAL_API_KEY). Ohne Extra-Toggle: ein Key in den Umgebungsvariablen reicht. Audio verlässt dabei den Mac.',
  });

  new Setting(section)
    .setName('Cloud-Backend aktiviert')
    .setDesc('Wenn aktiv und ein API-Key gesetzt ist, wird die Cloud bevorzugt — lokal bleibt Fallback')
    .addToggle((toggle) =>
      toggle
        .setValue(vs.cloudEnabled ?? false)
        .onChange(async (value) => {
          vs.cloudEnabled = value;
          await plugin.saveSettings();
          renderInto(section, plugin);
        }),
    );

  if (vs.cloudEnabled) {
    new Setting(section)
      .setName('API-Key')
      .setDesc('Groq- oder OpenAI-Key — wird nur lokal in den Plugin-Einstellungen gespeichert')
      .addText((text) =>
        text
          .setPlaceholder('gsk_… / sk-…')
          .setValue(vs.cloudApiKey ?? '')
          .onChange(async (value) => {
            vs.cloudApiKey = value.trim();
            await plugin.saveSettings();
          }),
      );

    new Setting(section)
      .setName('Basis-URL')
      .setDesc('OpenAI-kompatible Basis-URL (leer = Groq)')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_CLOUD_BASE_URL)
          .setValue(vs.cloudBaseUrl ?? '')
          .onChange(async (value) => {
            vs.cloudBaseUrl = value.trim();
            await plugin.saveSettings();
          }),
      );

    new Setting(section)
      .setName('Cloud-Modell')
      .setDesc('Leer = whisper-large-v3-turbo (Groq). OpenAI: whisper-1 oder gpt-4o-transcribe')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_CLOUD_MODEL)
          .setValue(vs.cloudModel ?? '')
          .onChange(async (value) => {
            vs.cloudModel = value.trim();
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
    const vibeEnv = getRuntimeEnvironmentVariables(plugin.settings, 'vibe');
    const cloud = resolveVoiceCloudConfig({
      cloudEnabled: vs.cloudEnabled,
      cloudApiKey: vs.cloudApiKey,
      cloudBaseUrl: vs.cloudBaseUrl,
      cloudModel: vs.cloudModel,
      env: {
        ...vibeEnv,
        GROQ_API_KEY: process.env.GROQ_API_KEY || vibeEnv.GROQ_API_KEY,
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || vibeEnv.MISTRAL_API_KEY,
      },
    });
    const resolver = new VoiceBackendResolver(vs.preferFastBackend, process.platform, undefined, cloud);
    const backend = await resolver.resolve();
    const live = isLiveSpeechSupported();
    if (live && backend) {
      backendStatusEl.textContent = `Live-Diktat aktiv · Fallback: ${backend.displayName}`;
    } else if (live) {
      backendStatusEl.textContent = 'Live-Diktat aktiv (System, kostenlos)';
    } else if (backend) {
      backendStatusEl.textContent = `Aktives Backend: ${backend.displayName}`;
    } else {
      backendStatusEl.textContent = 'Aktives Backend: nicht verfügbar';
    }
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
  new Setting(section)
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
  section.createEl('p', {
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

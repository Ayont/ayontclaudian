import { execFile } from 'child_process';
import { Notice, Setting } from 'obsidian';

import { McpServerManager } from '../../core/mcp/McpServerManager';
import type { ProviderRegistration, ProviderWorkspaceRegistration } from '../../core/providers/types';
import type ClaudianPlugin from '../../main';
import { GROK_PROVIDER_ICON, PERPLEXITY_PROVIDER_ICON } from '../../shared/icons';
import { McpStorage } from '../claude/storage/McpStorage';
import { desktopCapabilities } from './capabilities';
import { DesktopBridgeRuntime } from './DesktopBridgeRuntime';
import { type DesktopBridgeProviderId, desktopBridgeProviders } from './DesktopBridgeTransport';
import { desktopAppPath } from './helper';
import { DEFAULT_DESKTOP_SETTINGS, desktopContextWindowTokens, getDesktopSettings, updateDesktopSettings } from './settings';
const settingsSaves = new WeakMap<ClaudianPlugin, Promise<void>>();
/** Serialize both desktop settings panels; a failed save must not erase later edits. */
export function saveDesktopSettings(plugin: ClaudianPlugin, id: DesktopBridgeProviderId, update: Partial<typeof DEFAULT_DESKTOP_SETTINGS>): Promise<void> {
  const save = async () => {
    const previous = getDesktopSettings(plugin.settings, id);
    updateDesktopSettings(plugin.settings, id, update);
    try { await plugin.saveSettings(); }
    catch (error) {
      const rollback: Partial<typeof DEFAULT_DESKTOP_SETTINGS> = {};
      if ('enabled' in update) rollback.enabled = previous.enabled;
      for (const key of ['knowledgeTools', 'knowledgeMemory', 'knowledgeScope', 'knowledgeMemoryFolder'] as const) {
        if (key in update) Object.assign(rollback, { [key]: previous[key] });
      }
      if ('desktopMcp' in update) rollback.desktopMcp = previous.desktopMcp;
      if ('anchor' in update) rollback.anchor = previous.anchor;
      if ('localTools' in update) rollback.localTools = previous.localTools;
      if ('contextTools' in update) rollback.contextTools = previous.contextTools;
      if ('vaultTools' in update) rollback.vaultTools = previous.vaultTools;
      if ('vaultRoot' in update) rollback.vaultRoot = previous.vaultRoot;
      if ('commandExecution' in update) rollback.commandExecution = previous.commandExecution;
      if ('maxToolActions' in update) rollback.maxToolActions = previous.maxToolActions;
      if ('toolRoot' in update) rollback.toolRoot = previous.toolRoot;
      updateDesktopSettings(plugin.settings, id, rollback);
      throw error;
    }
  };
  const pending = settingsSaves.get(plugin);
  const result = pending ? pending.catch(() => undefined).then(save) : save();
  settingsSaves.set(plugin, result);
  void result.finally(() => { if (settingsSaves.get(plugin) === result) settingsSaves.delete(plugin); }).catch(() => undefined);
  return result;
}
const unsupported = async (): Promise<never> => { throw new Error('Im Desktop-Relay nicht unterstützt: keine versteckten Anfragen; lokale Werkzeuge nur im sichtbaren Chat.'); };
export function desktopRegistration(id: DesktopBridgeProviderId): ProviderRegistration {
  const model = `desktop:${id}`;
  return {
    displayName: desktopBridgeProviders.find(p => p.id === id)!.displayName,
    blankTabOrder: id === 'grok-bot' ? 30 : 31,
    isEnabled: settings => getDesktopSettings(settings, id).enabled,
    capabilities: desktopCapabilities(id), defaultConfig: { ...DEFAULT_DESKTOP_SETTINGS },
    brandColor: id === 'grok-bot' ? '#A0A0A0' : '#20A7A7',
    chatUIConfig: {
      getModelOptions: () => [{ value: model, label: 'Modell in der App', description: 'Experimentelles Desktop-UI · keine API · lokale Werkzeuge separat freigeben' }],
      ownsModel: value => value === model, isDefaultModel: value => value === model,
      normalizeModelVariant: () => model, getCustomModelIds: () => new Set(),
      isAdaptiveReasoningModel: () => false, getReasoningOptions: () => [], getDefaultReasoningValue: () => '',
      getContextWindowSize: (model, customLimits) => desktopContextWindowTokens(id, model, customLimits), applyModelDefaults: () => {},
      getProviderIcon: () => id === 'grok-bot' ? GROK_PROVIDER_ICON : PERPLEXITY_PROVIDER_ICON,
    },
    settingsReconciler: { reconcileModelWithEnvironment: () => ({ changed: false, invalidatedConversations: [] }), normalizeModelVariantSettings: () => false },
    createRuntime: ({ plugin }) => new DesktopBridgeRuntime(plugin, id),
    createAuxQueryRunner: () => ({ query: unsupported, reset: () => {} }),
    createTitleGenerationService: () => ({ generateTitle: async (conversationId, text, callback) => { await callback(conversationId, { success: true, title: text.replace(/\s+/g, ' ').slice(0, 60) || 'Desktop-Chat' }); }, cancel: () => {} }),
    createInstructionRefineService: () => ({ refineInstruction: unsupported, continueConversation: unsupported, cancel: () => {}, resetConversation: () => {} }),
    createInlineEditService: () => ({ editText: unsupported, continueConversation: unsupported, cancel: () => {}, resetConversation: () => {} }),
    historyService: { hydrateConversationHistory: async () => {}, deleteConversationSession: async () => {}, resolveSessionIdForConversation: () => null, isPendingForkConversation: () => false, buildForkProviderState: () => { throw new Error('Desktop-Chats können nicht verzweigt werden.'); } },
    taskResultInterpreter: { hasAsyncLaunchMarker: () => false, extractAgentId: () => null, extractStructuredResult: () => null, resolveTerminalStatus: (_value, fallback) => fallback, extractTagValue: () => null },
  };
}
export function desktopWorkspaceRegistration(id: DesktopBridgeProviderId): ProviderWorkspaceRegistration {
  return { initialize: async ({ vaultAdapter }) => {
    const mcpStorage = new McpStorage(vaultAdapter);
    const mcpServerManager = new McpServerManager(mcpStorage);
    await mcpServerManager.loadServers();
    return { mcpStorage, mcpServerManager,
    cliResolver: { resolveFromSettings: () => desktopAppPath(id), reset: () => {} },
    tabWarmupPolicy: { resolveMode: () => 'none' },
    settingsTabRenderer: { render: (container, { plugin, refreshModelSelectors }) => {
      container.createEl('p', { text: 'Experimentelles Desktop-UI-Relay, nur macOS. Nutzt die bestehende App-Anmeldung (kein OAuth/API). Perplexity: normaler Chat, nicht Computer; Pro-Berechtigung wird nicht geprüft. Kein allgemeiner PC-/Vault-Zugriff.' });
      container.createEl('p', { text: 'Text-Chat nutzt das Kontextfenster der App (Grok 500.000 Token, Perplexity 200.000 Token). Werkzeugrunden bleiben bei maximal 2000 UTF-16-Zeichen. Automatischer Memory-, Vault- und Graph-Kontext sowie Coding-Anweisungen für normale Chat-Antworten werden hier nicht ergänzt. Vom Modell ausgegebene Memory-Blöcke werden nicht automatisch gespeichert, auch bei aktivierten lokalen Werkzeugen. Die globale Memory-Einstellung anderer Provider bleibt unverändert. Eigener Text wird nicht gekürzt. Explizite @Notizen und Editor-Markierungen brauchen das separate Auswahlkontext-Opt-in sowie Einzel-Freigaben. Aktuelle Notizen werden nicht automatisch angehängt. Browser-/Canvas-Auswahlen und Anhänge werden abgewiesen. MCP-Tools benötigen das separate Opt-in.' });
      container.createEl('p', { text: 'Die App erhält den vollständigen vorbereiteten Prompt. Vordergrund und Zwischenablage werden benötigt. Währenddessen nicht tippen oder Chats wechseln. Abbruch beendet nur lokales Warten; der App-Auftrag kann weiterlaufen. Niemals automatisch erneut senden.' });
      container.createEl('p', { text: 'Voraussetzungen: macOS, installierte App und Swift/Xcode Command Line Tools; Bedienungshilfen für den ausführenden Obsidian-/Helper-Prozess in den Systemeinstellungen erlauben. Grok Bot ist die Desktop-App, nicht der separate Grok-Build-CLI-Provider. Modell direkt in der App auswählen.' });
      container.createEl('p', { text: 'Für jeden neuen Claudian-Chat einen eigenen App-Chat mit eindeutigem sichtbaren Nachrichtentext anlegen. Diesen Text exakt (einschließlich Groß-/Kleinschreibung) als Anker eintragen und den App-Chat geöffnet lassen; ein frei erfundener Name oder nur der Sidebar-Titel genügt nicht. Bereits gebundene Anker dürfen nicht für andere Claudian-Chats wiederverwendet werden.' });
      new Setting(container).setName('Desktop-Relay ausdrücklich aktivieren').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).enabled).onChange(async enabled => { try { await saveDesktopSettings(plugin, id, { enabled }); refreshModelSelectors(); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).enabled); new Notice('Speichern fehlgeschlagen. Aktivierung wurde zurückgesetzt.'); } }));
      new Setting(container).setName('Eindeutiger sichtbarer Chat-Anker').addText(text => text.setValue(getDesktopSettings(plugin.settings, id).anchor).onChange(async anchor => { try { await saveDesktopSettings(plugin, id, { anchor }); } catch { text.setValue(getDesktopSettings(plugin.settings, id).anchor); new Notice('Chat-Anker konnte nicht gespeichert werden.'); } }));
      new Setting(container).setName('Lokale Werkzeuge (experimentell)').setDesc('Dateien auflisten/lesen/ersetzen nur im freigegebenen Ordner. Jede Aktion und Datenübertragung an die App braucht eine Einzelfreigabe. Kein allgemeiner PC-, Bildschirm- oder Browserzugriff. Ohne separates Host-Coding-Opt-in nur pwd und wc -l.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).localTools).onChange(async localTools => { try { await saveDesktopSettings(plugin, id, { localTools }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).localTools); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('MCP-Tools separat aktivieren').setDesc('Standard aus. Konfigurierte Server aus .claude/mcp.json über die MCP-Verwaltung; aktivierte Server, Kontextsparmodus und @Auswahl gelten. Nur STDIO und Streamable HTTP. STDIO läuft mit Host-Rechten, NICHT in einer Sandbox; Arbeitsordner ist keine Zugriffssperre. Remote-Server erhalten Anfragen, die App erhält separat freigegebene Metadaten/Ergebnisse. Verbindung, Aufruf und exakte Seiten brauchen Einzel-Freigaben. Kein OAuth, keine Ressourcen/Prompts, kein Legacy-SSE/Windows. Freigegebener Arbeitsordner erforderlich.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).desktopMcp).onChange(async desktopMcp => { try { await saveDesktopSettings(plugin, id, { desktopMcp }); refreshModelSelectors(); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).desktopMcp); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Wissen: Graph/Backlinks separat aktivieren').setDesc('Standard aus. Nur auf Modellanfrage im expliziten Vault-Unterordner. Lokale Metadaten, Trefferpfade, Lesen und exakte Textseiten brauchen einzelne Freigaben. Maximal 4 Nachbarn / Tiefe 3; große Graphen werden abgewiesen. Kein automatischer Kontext, Index, RAG oder Memory-Schreiben.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).knowledgeTools).onChange(async knowledgeTools => { try { await saveDesktopSettings(plugin, id, { knowledgeTools }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).knowledgeTools); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Freigegebener Wissens-Unterordner').setDesc('Vault-relativer vorhandener Ordner, z. B. Projekte/Test; nicht die Vault-Wurzel. Keine versteckten Ordner oder Links.').addText(text => text.setValue(getDesktopSettings(plugin.settings, id).knowledgeScope).onChange(async knowledgeScope => { try { await saveDesktopSettings(plugin, id, { knowledgeScope }); } catch { text.setValue(getDesktopSettings(plugin.settings, id).knowledgeScope); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Lexikalischen Memory-Recall separat freigeben').setDesc('Standard aus. Liest nach Einzelfreigabe den gesamten begrenzten konfigurierten Memory-Ordner lokal (max. 256 Notizen / 64 KiB), liefert Top 4. Kein semantisches RAG, keine Netzwerk-Embeddings, kein Schreiben. Globales Memory anderer Provider bleibt unverändert.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).knowledgeMemory).onChange(async knowledgeMemory => { try { await saveDesktopSettings(plugin, id, { knowledgeMemory, knowledgeMemoryFolder: knowledgeMemory ? plugin.settings.memoryFolder || '.claudian/memory' : '' }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).knowledgeMemory); new Notice('Speichern fehlgeschlagen.'); } }));
      container.createEl('p', { text: `Recall-Ordner: ${plugin.settings.memoryFolder || '.claudian/memory'}. Änderung des globalen Ordners erfordert erneute Freigabe. Daten werden nur nach separater Freigabe an die App übertragen. Begrenzte lokale Dateiprüfungen können die UI kurz blockieren; keine OS-Sandbox. Kombinierte Werkzeugfamilien werden bei Bedarf einzeln entdeckt; eigener Text wird nie gekürzt.` });
      new Setting(container).setName('Auswahlkontext separat aktivieren').setDesc('Standard aus. Explizite @Notizen und markierter Editor-Text, maximal 4 Einträge / 64 KiB UTF-8. Lokales Lesen, Metadaten und jede exakte Textseite separat freigeben. Kein automatischer aktueller Notizinhalt, Recall oder Memory-Schreiben.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).contextTools).onChange(async contextTools => { try { await saveDesktopSettings(plugin, id, { contextTools }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).contextTools); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Vault-Werkzeuge separat aktivieren').setDesc('Standard aus. Markdown suchen/lesen und gezielt ändern bis 64 KiB, exakter Patch maximal 1200 Zeichen. Jede Aktion einschließlich Trefferübertragung braucht Einzelfreigabe. Kein automatisches Memory, keine Anhänge; keine langen Neuanlagen.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).vaultTools).onChange(async vaultTools => { try { await saveDesktopSettings(plugin, id, { vaultTools }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).vaultTools); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Freigegebener Vault-Ordner').setDesc('Expliziter absoluter Pfad innerhalb dieses Vaults; leer = kein Zugriff. Versteckte Ordner, Zugangsdaten und Links bleiben gesperrt.').addText(text => text.setValue(getDesktopSettings(plugin.settings, id).vaultRoot).onChange(async vaultRoot => { try { await saveDesktopSettings(plugin, id, { vaultRoot }); } catch { text.setValue(getDesktopSettings(plugin.settings, id).vaultRoot); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Host-Coding-Befehle ausdrücklich erlauben').setDesc('HOST EXECUTION — NOT SANDBOX. Programme laufen mit Ihren Benutzerrechten, können außerhalb des Ordners lesen/schreiben, Netzwerk, Paketskripte und Git-Hooks ausführen. Fester PATH, keine geerbten Token-Variablen; Host-Dateien bleiben zugänglich. Jede exakte argv/cwd/Timeout-Anfrage braucht Einzelfreigabe. Lokale Werkzeuge müssen ebenfalls aktiv sein.').addToggle(toggle => toggle.setValue(getDesktopSettings(plugin.settings, id).commandExecution).onChange(async commandExecution => { try { await saveDesktopSettings(plugin, id, { commandExecution }); } catch { toggle.setValue(getDesktopSettings(plugin.settings, id).commandExecution); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Maximale Werkzeugaktionen je Anfrage').setDesc('1–30; Standard 12. Keine automatischen Wiederholungen.').addDropdown(dropdown => dropdown.addOption('4', '4').addOption('12', '12').addOption('20', '20').addOption('30', '30').setValue(String(getDesktopSettings(plugin.settings, id).maxToolActions)).onChange(async value => { try { await saveDesktopSettings(plugin, id, { maxToolActions: Number(value) }); } catch { dropdown.setValue(String(getDesktopSettings(plugin.settings, id).maxToolActions)); new Notice('Speichern fehlgeschlagen.'); } }));
      new Setting(container).setName('Freigegebener Arbeitsordner').setDesc('Absoluter Pfad zu einem vorhandenen, eigenen Test-/Arbeitsordner. Leer = kein Zugriff. Keine Links, Zugangsdaten, Home- oder Systemwurzel.').addText(text => text.setValue(getDesktopSettings(plugin.settings, id).toolRoot).onChange(async toolRoot => { try { await saveDesktopSettings(plugin, id, { toolRoot }); } catch { text.setValue(getDesktopSettings(plugin.settings, id).toolRoot); new Notice('Arbeitsordner nicht gespeichert.'); } }));
      new Setting(container).setName('App öffnen / dort anmelden').addButton(button => button.setButtonText('App öffnen').onClick(() => {
        const app = desktopAppPath(id); if (!app) { new Notice('App nicht gefunden oder kein macOS.'); return; }
        execFile('/usr/bin/open', [app], error => { if (error) new Notice(error.message); });
      }));
      new Setting(container).setName('Lokale Voraussetzungen prüfen').setDesc('Prüft App und Swift, nicht Anmeldung, Pro-Abo oder Bedienungshilfen. Diese werden erst beim sichtbaren Senden geprüft.').addButton(button => button.setButtonText('Prüfen').onClick(() => { new Notice(desktopAppPath(id) ? 'App und Swift gefunden. Anmeldung, Chat-Anker und Bedienungshilfen noch manuell prüfen.' : 'macOS-App oder Swift fehlt.'); }));
    } },
  }; } };
}

/**
 * Locale-aware strings for the dashboard + New Project modal.
 *
 * The app is English by default; a German user (locale `de`) sees German. Rather
 * than bloat the central TranslationKey union with ~60 keys, this surface keeps
 * its own English/German table and selects by the current locale (falling back
 * to English for every other locale, mirroring the i18n service).
 */

import { getLocale } from '../../i18n/i18n';

export interface DashboardStrings {
  // Header
  headerSubtitle: string;
  badgeActive: string;
  badgeMissions: (n: number) => string;
  providerAria: (name: string) => string;
  // Sections
  systemOverview: string;
  systemOverviewDetail: string;
  providerCapabilities: string;
  providerCapabilitiesDetail: string;
  enabledProviders: string;
  chipActive: string;
  available: string;
  notSupported: string;
  featureMap: string;
  featureMapDetail: string;
  quickActions: string;
  quickActionsDetail: string;
  activity: string;
  activityDetail: string;
  activityEmpty: string;
  // Card titles
  cardProjects: string;
  cardMemory: string;
  cardUsage: string;
  cardRag: string;
  cardWorkflows: string;
  cardAgents: string;
  // Card actions
  actCreate: string;
  actBrowse: string;
  actReset: string;
  actIndex: string;
  actView: string;
  actRun: string;
  // Card subtitles
  latest: (name: string) => string;
  noProjects: string;
  noMemories: string;
  session: (n: string) => string;
  vaultChunks: string;
  notIndexed: string;
  scheduledAutomations: string;
  noWorkflows: string;
  specialistsReady: string;
  runningNow: (n: number) => string;
  // Feature map
  fmModelRouter: string;
  fmModelRouterDetail: string;
  fmAgentMemory: string;
  fmAgentMemoryDetail: string;
  fmVaultRag: string;
  fmVaultRagDetail: string;
  fmVision: string;
  fmVisionDetail: string;
  fmAutoMode: string;
  fmAutoModeDetail: string;
  fmDiffPreview: string;
  fmDiffPreviewDetail: string;
  fmTokenGuard: string;
  fmTokenGuardDetail: string;
  fmWorkflows: string;
  fmWorkflowsDetail: string;
  valActive: string;
  valOff: string;
  valChunks: (n: number) => string;
  valNotIndexed: string;
  valReady: string;
  valNoProvider: string;
  valWorkflowsActive: (active: number, total: number) => string;
  // Quick actions
  qaIndexRag: string;
  qaRunMultiAgent: string;
  qaNewProject: string;
  qaMissionLog: string;
  qaTokenUsage: string;
  qaArtifacts: string;
  qaRefresh: string;
  qaRefreshed: string;
  // Notices
  tokenReset: string;
  actionFailed: (msg: string) => string;
  // New Project modal
  npTitle: string;
  npSubtitle: string;
  npName: string;
  npNameDesc: string;
  npNamePlaceholder: string;
  npDescription: string;
  npDescriptionDesc: string;
  npDescriptionPlaceholder: string;
  npInstructions: string;
  npInstructionsDesc: string;
  npInstructionsPlaceholder: string;
  npCancel: string;
  npCreate: string;
  npErrNameRequired: string;
  npErrNameInvalid: string;
  npErrDuplicate: (name: string) => string;
  npCreated: (name: string, id: string) => string;
  npFailed: (msg: string) => string;
}

const EN: DashboardStrings = {
  headerSubtitle: 'Agent workspace for your vault',
  badgeActive: 'Active',
  badgeMissions: (n) => `${n} mission${n > 1 ? 's' : ''} active`,
  providerAria: (name) => `Active provider: ${name}`,
  systemOverview: 'System overview',
  systemOverviewDetail: 'Live state of your agent workspace',
  providerCapabilities: 'Provider capabilities',
  providerCapabilitiesDetail: 'What your active runtime provider supports directly',
  enabledProviders: 'Enabled providers',
  chipActive: 'active',
  available: 'Available',
  notSupported: 'Not supported',
  featureMap: 'Feature map',
  featureMapDetail: 'Your key Claudian systems at a glance',
  quickActions: 'Quick actions',
  quickActionsDetail: 'Common tasks without detours',
  activity: 'Activity',
  activityDetail: 'Events from missions, memory and workflows',
  activityEmpty: 'No activity yet — start a mission or chat to see events here.',
  cardProjects: 'Projects',
  cardMemory: 'Memory',
  cardUsage: 'Token usage',
  cardRag: 'RAG index',
  cardWorkflows: 'Workflows',
  cardAgents: 'Agents',
  actCreate: 'Create',
  actBrowse: 'Browse',
  actReset: 'Reset',
  actIndex: 'Index',
  actView: 'View',
  actRun: 'Run',
  latest: (name) => `Latest: ${name}`,
  noProjects: 'No projects yet',
  noMemories: 'No memories yet',
  session: (n) => `Session: ${n} tokens`,
  vaultChunks: 'Vault chunks indexed',
  notIndexed: 'Not indexed yet',
  scheduledAutomations: 'Scheduled automations',
  noWorkflows: 'No workflows yet',
  specialistsReady: 'Specialist agents ready',
  runningNow: (n) => `${n} running now`,
  fmModelRouter: 'Model Router',
  fmModelRouterDetail: 'Picks the best model automatically',
  fmAgentMemory: 'Agent Memory',
  fmAgentMemoryDetail: 'Remembers project-scoped facts',
  fmVaultRag: 'Vault RAG',
  fmVaultRagDetail: 'Semantic context from your vault',
  fmVision: 'Vision',
  fmVisionDetail: 'Analyzes images and screenshots',
  fmAutoMode: 'Auto Mode',
  fmAutoModeDetail: 'Continues long goals unattended',
  fmDiffPreview: 'Diff Preview',
  fmDiffPreviewDetail: 'Shows changes before applying',
  fmTokenGuard: 'Token Guard',
  fmTokenGuardDetail: 'Watches session and daily budget',
  fmWorkflows: 'Workflows',
  fmWorkflowsDetail: 'Time- and event-driven automations',
  valActive: 'Active',
  valOff: 'Off',
  valChunks: (n) => `${n} chunks`,
  valNotIndexed: 'Not indexed',
  valReady: 'Ready',
  valNoProvider: 'No provider',
  valWorkflowsActive: (active, total) => `${active}/${total} active`,
  qaIndexRag: 'Index Vault RAG',
  qaRunMultiAgent: 'Run Multi-Agent',
  qaNewProject: 'New Project',
  qaMissionLog: 'Mission Log',
  qaTokenUsage: 'Token Usage',
  qaArtifacts: 'Artifacts',
  qaRefresh: 'Refresh',
  qaRefreshed: 'Refreshed',
  tokenReset: 'Token budget reset.',
  actionFailed: (msg) => `Dashboard action failed: ${msg}`,
  npTitle: 'New project',
  npSubtitle: 'Projects bundle instructions, skills and memories for one work context.',
  npName: 'Name',
  npNameDesc: 'Required. Determines the project folder and file name.',
  npNamePlaceholder: 'e.g. Veylor Backend',
  npDescription: 'Description',
  npDescriptionDesc: 'Optional. What is this project for?',
  npDescriptionPlaceholder: 'Short description …',
  npInstructions: 'Instructions',
  npInstructionsDesc: 'Optional. System hints applied whenever this project is active.',
  npInstructionsPlaceholder: 'e.g. Always answer in English, use Java 21 …',
  npCancel: 'Cancel',
  npCreate: 'Create project',
  npErrNameRequired: 'Please enter a project name.',
  npErrNameInvalid: 'The name must contain at least one letter or digit.',
  npErrDuplicate: (name) => `A project "${name}" already exists.`,
  npCreated: (name, id) => `Project "${name}" created (${id}).`,
  npFailed: (msg) => `Could not create project: ${msg}`,
};

const DE: DashboardStrings = {
  headerSubtitle: 'Dein Agenten-Arbeitsbereich für den Vault',
  badgeActive: 'Aktiv',
  badgeMissions: (n) => `${n} Mission${n > 1 ? 'en' : ''} aktiv`,
  providerAria: (name) => `Aktiver Provider: ${name}`,
  systemOverview: 'Systemübersicht',
  systemOverviewDetail: 'Live-Zustand deines Agent-Workspace',
  providerCapabilities: 'Provider-Fähigkeiten',
  providerCapabilitiesDetail: 'Was dein aktiver Runtime-Provider direkt unterstützt',
  enabledProviders: 'Aktivierte Provider',
  chipActive: 'aktiv',
  available: 'Verfügbar',
  notSupported: 'Nicht unterstützt',
  featureMap: 'Feature Map',
  featureMapDetail: 'Deine wichtigsten Claudian-Systeme auf einen Blick',
  quickActions: 'Schnellaktionen',
  quickActionsDetail: 'Häufige Aufgaben ohne Umwege',
  activity: 'Aktivität',
  activityDetail: 'Ereignisse aus Missionen, Memory und Workflows',
  activityEmpty: 'Noch keine Aktivität — starte eine Mission oder einen Chat, um Ereignisse zu sehen.',
  cardProjects: 'Projekte',
  cardMemory: 'Erinnerungen',
  cardUsage: 'Token-Verbrauch',
  cardRag: 'RAG-Index',
  cardWorkflows: 'Workflows',
  cardAgents: 'Agenten',
  actCreate: 'Erstellen',
  actBrowse: 'Öffnen',
  actReset: 'Zurücksetzen',
  actIndex: 'Indexieren',
  actView: 'Anzeigen',
  actRun: 'Starten',
  latest: (name) => `Zuletzt: ${name}`,
  noProjects: 'Noch keine Projekte',
  noMemories: 'Noch keine Erinnerungen',
  session: (n) => `Sitzung: ${n} Tokens`,
  vaultChunks: 'Vault-Chunks indexiert',
  notIndexed: 'Noch nicht indexiert',
  scheduledAutomations: 'Geplante Automationen',
  noWorkflows: 'Noch keine Workflows',
  specialistsReady: 'Spezialisten bereit',
  runningNow: (n) => `${n} laufen gerade`,
  fmModelRouter: 'Model Router',
  fmModelRouterDetail: 'Wählt automatisch das passende Modell',
  fmAgentMemory: 'Agent Memory',
  fmAgentMemoryDetail: 'Erinnert projektbezogene Fakten',
  fmVaultRag: 'Vault RAG',
  fmVaultRagDetail: 'Semantischer Kontext aus deinem Vault',
  fmVision: 'Vision',
  fmVisionDetail: 'Analysiert Bilder und Screenshots',
  fmAutoMode: 'Auto Mode',
  fmAutoModeDetail: 'Führt lange Ziele unbeaufsichtigt fort',
  fmDiffPreview: 'Diff Preview',
  fmDiffPreviewDetail: 'Zeigt Änderungen vor der Freigabe',
  fmTokenGuard: 'Token Guard',
  fmTokenGuardDetail: 'Überwacht Session- und Tagesbudget',
  fmWorkflows: 'Workflows',
  fmWorkflowsDetail: 'Zeit- und eventgesteuerte Automationen',
  valActive: 'Aktiv',
  valOff: 'Aus',
  valChunks: (n) => `${n} Chunks`,
  valNotIndexed: 'Nicht indexiert',
  valReady: 'Bereit',
  valNoProvider: 'Kein Provider',
  valWorkflowsActive: (active, total) => `${active}/${total} aktiv`,
  qaIndexRag: 'Vault-RAG indexieren',
  qaRunMultiAgent: 'Multi-Agent starten',
  qaNewProject: 'Neues Projekt',
  qaMissionLog: 'Missions-Log',
  qaTokenUsage: 'Token-Verbrauch',
  qaArtifacts: 'Artefakte',
  qaRefresh: 'Aktualisieren',
  qaRefreshed: 'Aktualisiert',
  tokenReset: 'Token-Budget zurückgesetzt.',
  actionFailed: (msg) => `Dashboard-Aktion fehlgeschlagen: ${msg}`,
  npTitle: 'Neues Projekt',
  npSubtitle: 'Projekte bündeln Instruktionen, Skills und Erinnerungen für einen Arbeitskontext.',
  npName: 'Name',
  npNameDesc: 'Pflichtfeld. Bestimmt den Ordner- und Dateinamen des Projekts.',
  npNamePlaceholder: 'z. B. Veylor Backend',
  npDescription: 'Beschreibung',
  npDescriptionDesc: 'Optional. Wofür ist dieses Projekt?',
  npDescriptionPlaceholder: 'Kurzbeschreibung …',
  npInstructions: 'Instruktionen',
  npInstructionsDesc: 'Optional. Systemhinweise, die bei aktivem Projekt immer mitgegeben werden.',
  npInstructionsPlaceholder: 'z. B. Antworte immer auf Deutsch, nutze Java 21 …',
  npCancel: 'Abbrechen',
  npCreate: 'Projekt erstellen',
  npErrNameRequired: 'Bitte gib einen Projektnamen ein.',
  npErrNameInvalid: 'Der Name muss mindestens einen Buchstaben oder eine Ziffer enthalten.',
  npErrDuplicate: (name) => `Ein Projekt „${name}" existiert bereits.`,
  npCreated: (name, id) => `Projekt „${name}" erstellt (${id}).`,
  npFailed: (msg) => `Projekt konnte nicht erstellt werden: ${msg}`,
};

/** Current dashboard strings for the active locale (English default, German for `de`). */
export function dashboardStrings(): DashboardStrings {
  return getLocale() === 'de' ? DE : EN;
}

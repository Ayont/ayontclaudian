/**
 * Design preview hub.
 *
 * Generates a standalone `preview/index.html` that renders the plugin's real
 * `styles.css` against representative markup for several surfaces (dashboard,
 * chat message, modals) with mock data — so the design can be iterated in any
 * browser (screenshot → tweak CSS → rebuild) without launching Obsidian.
 *
 * The plugin CSS consumes Obsidian's theme variables (`--background-primary`,
 * `--text-normal`, `--interactive-accent`, …). Those are shimmed below for both
 * dark and light, so surfaces look like they do inside Obsidian.
 *
 * Usage: `npm run preview` → open `preview/index.html`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'styles.css');
const OUT_DIR = join(ROOT, 'preview');
const OUT = join(OUT_DIR, 'index.html');

if (!existsSync(STYLES)) {
  console.error('[preview] styles.css missing — run `npm run build` first.');
  process.exit(1);
}
const pluginCss = readFileSync(STYLES, 'utf-8');

// ── Obsidian theme variable shim (dark + light) ──────────────────────────────
const THEME_SHIM = `
:root, body.theme-dark {
  --background-primary: #17171a;
  --background-primary-alt: #101013;
  --background-secondary: #1e1e23;
  --background-secondary-alt: #26262c;
  --background-modifier-border: rgba(255,255,255,0.09);
  --background-modifier-border-hover: rgba(255,255,255,0.17);
  --background-modifier-hover: rgba(255,255,255,0.06);
  --text-normal: #e7e7ea;
  --text-muted: #a1a1ab;
  --text-faint: #6c6c76;
  --text-error: #ff6b6b;
  --text-on-accent: #ffffff;
  --text-accent: #d97757;
  --interactive-accent: #d97757;
  --interactive-accent-rgb: 217,119,87;
  --color-green: #4ec98a; --color-green-rgb: 78,201,138;
  --color-red: #ff6b6b; --color-red-rgb: 255,107,107;
  --font-interface: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-monospace: ui-monospace, 'SF Mono', Menlo, monospace;
  --font-ui-smaller: 12px; --font-ui-small: 13px; --font-ui-medium: 15px; --font-ui-large: 20px;
  --font-medium: 500; --font-semibold: 600;
}
body.theme-light {
  --background-primary: #ffffff;
  --background-primary-alt: #f4f4f6;
  --background-secondary: #f6f6f8;
  --background-secondary-alt: #ececef;
  --background-modifier-border: rgba(0,0,0,0.10);
  --background-modifier-border-hover: rgba(0,0,0,0.18);
  --background-modifier-hover: rgba(0,0,0,0.05);
  --text-normal: #1f2023;
  --text-muted: #55565c;
  --text-faint: #8a8b92;
  --text-accent: #c15f3c;
}
html, body { margin: 0; background: var(--background-primary); color: var(--text-normal); font-family: var(--font-interface); }
`;

// ── Icons ────────────────────────────────────────────────────────────────────
// The product renders icons with Obsidian's `setIcon()`, which injects Lucide
// SVGs — unavailable to this standalone script. Without them every icon slot
// rendered as an empty rounded box, which misrepresented the surface badly
// (icon colour, size and optical weight are load-bearing in this design).
// These are the same Lucide glyphs the real views ask for, keyed by the same
// name, so adding an icon here means copying the name out of the `setIcon` call.
const LUCIDE = {
  'folder-kanban': '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/>',
  'brain-circuit': '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'git-fork': '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  'message-square-code': '<path d="M10 7.5 8 10l2 2.5"/><path d="m14 7.5 2 2.5-2 2.5"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'scan-eye': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  'file-diff': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'scroll-text': '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'library-big': '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
};

const icon = (name, size = 16) => {
  const body = LUCIDE[name];
  if (!body) throw new Error(`[preview] unknown Lucide icon: ${name}`);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};

// ── Mock helpers (mirror the real DOM classes) ───────────────────────────────
const statCard = (status, iconName, action, value, title, subtitle) => `
  <div class="claudian-dashboard-card claudian-dashboard-card--${status}" role="button" tabindex="0">
    <div class="claudian-dashboard-card-header">
      <span class="claudian-dashboard-card-icon">${icon(iconName)}</span>
      <span class="claudian-dashboard-card-action">${action}</span>
    </div>
    <div class="claudian-dashboard-card-value">${value}</div>
    <h3 class="claudian-dashboard-card-title">${title}</h3>
    <p class="claudian-dashboard-card-subtitle">${subtitle}</p>
  </div>`;

const capability = (iconName, label, supported) => `
  <div class="claudian-dashboard-capability${supported ? ' is-supported' : ''}">
    <span class="claudian-dashboard-capability-icon">${icon(iconName, 14)}</span>
    <div class="claudian-dashboard-capability-copy">
      <span class="claudian-dashboard-capability-label">${label}</span>
      <span class="claudian-dashboard-capability-state">${supported ? 'Verfügbar' : 'Nicht unterstützt'}</span>
    </div>
    <span class="claudian-dashboard-capability-check">${icon(supported ? 'check' : 'minus', 13)}</span>
  </div>`;

const feature = (iconName, label, detail, value, active) => `
  <div class="claudian-dashboard-feature${active ? ' is-active' : ''}" role="listitem">
    <span class="claudian-dashboard-feature-icon">${icon(iconName, 15)}</span>
    <div class="claudian-dashboard-feature-copy">
      <span class="claudian-dashboard-feature-label">${label}</span>
      <span class="claudian-dashboard-feature-detail">${detail}</span>
    </div>
    <span class="claudian-dashboard-feature-value">${value}</span>
  </div>`;

const actionBtn = (iconName, label, primary = false) =>
  `<button class="claudian-dashboard-action-btn${primary ? ' claudian-dashboard-action-btn--primary' : ''}"><span>${icon(iconName, 14)}</span><span>${label}</span></button>`;

const section = (title, detail) =>
  `<div class="claudian-dashboard-section-heading"><h3>${title}</h3><span>${detail}</span></div>`;

// ── Surfaces ─────────────────────────────────────────────────────────────────
// Labels, icons and section copy mirror src/features/dashboard/ — the German
// locale, because that is the product voice. Previously this harness carried the
// English strings, so it showed a UI the user never sees.
const dashboard = `
<div class="claudian-dashboard" data-provider="claude">
  <div class="claudian-dashboard-header">
    <div class="claudian-dashboard-title-group">
      <span class="claudian-dashboard-logo">${icon('bot', 20)}</span>
      <div class="claudian-dashboard-text-group">
        <h2>Claudian OS</h2>
        <p>Agenten-Arbeitsplatz für deinen Vault</p>
      </div>
    </div>
    <div class="claudian-dashboard-status">
      <span class="claudian-dashboard-provider-chip" data-provider="claude"><span class="claudian-dashboard-provider-dot"></span><span>Claude</span></span>
      <span class="claudian-dashboard-status-dot claudian-dashboard-status-dot--active"></span>
      <span class="claudian-dashboard-live">Aktiv</span>
    </div>
  </div>

  ${section('Systemübersicht', 'Live-Zustand deines Agenten-Arbeitsplatzes')}
  <div class="claudian-dashboard-grid">
    ${statCard('info', 'folder-kanban', 'Erstellen', '3', 'Projekte', 'Zuletzt: Veylor Backend')}
    ${statCard('ok', 'brain-circuit', 'Öffnen', '17', 'Erinnerungen', 'Zuletzt: Performance-Architektur')}
    ${statCard('warning', 'gauge', 'Zurücksetzen', '130.144', 'Token-Verbrauch', 'Sitzung: 130.144 Tokens')}
    ${statCard('ok', 'search', 'Indexieren', '1.960', 'RAG-Index', 'Vault-Chunks indexiert')}
    ${statCard('info', 'workflow', 'Anzeigen', '2', 'Workflows', 'Geplante Automationen')}
    ${statCard('accent', 'users', 'Starten', '20', 'Agenten', 'Spezialisten bereit')}
  </div>

  ${section('Provider-Fähigkeiten', 'Was dein aktiver Runtime-Provider direkt unterstützt')}
  <div class="claudian-dashboard-capabilities">
    <div class="claudian-dashboard-provider-rail">
      <span class="claudian-dashboard-provider-rail-label">Aktivierte Provider</span>
      <div class="claudian-dashboard-provider-list">
        <span class="claudian-dashboard-provider-item" data-provider="opencode"><span class="claudian-dashboard-provider-item-dot"></span><span>OpenCode</span></span>
        <span class="claudian-dashboard-provider-item" data-provider="kimi"><span class="claudian-dashboard-provider-item-dot"></span><span>Kimi</span></span>
        <span class="claudian-dashboard-provider-item is-active" data-provider="claude"><span class="claudian-dashboard-provider-item-dot"></span><span>Claude</span><span class="claudian-dashboard-provider-item-current">aktiv</span></span>
      </div>
    </div>
    <div class="claudian-dashboard-capability-grid">
      ${capability('image', 'Bilder &amp; Vision', true)}
      ${capability('list-checks', 'Plan Mode', true)}
      ${capability('plug', 'MCP Tools', true)}
      ${capability('users', 'Multi-Agent', true)}
      ${capability('history', 'Rewind', true)}
      ${capability('git-fork', 'Fork', true)}
      ${capability('message-square-code', 'Instructions', true)}
      ${capability('route', 'Live Steering', false)}
    </div>
  </div>

  ${section('Feature Map', 'Deine wichtigsten Claudian-Systeme auf einen Blick')}
  <div class="claudian-dashboard-feature-map" role="list">
    ${feature('route', 'Model Router', 'Wählt automatisch das passende Modell', 'Aus', false)}
    ${feature('brain-circuit', 'Agent Memory', 'Erinnert projektbezogene Fakten', 'Aktiv', true)}
    ${feature('search', 'Vault RAG', 'Semantischer Kontext aus deinem Vault', '1960 Chunks', true)}
    ${feature('scan-eye', 'Vision', 'Analysiert Bilder und Screenshots', 'Bereit', true)}
    ${feature('bot', 'Auto Mode', 'Führt lange Ziele unbeaufsichtigt fort', 'Aktiv', true)}
    ${feature('file-diff', 'Diff Preview', 'Zeigt Änderungen vor der Freigabe', 'Aktiv', true)}
    ${feature('shield-check', 'Token Guard', 'Überwacht Session- und Tagesbudget', 'Aus', false)}
    ${feature('workflow', 'Workflows', 'Zeit- und eventgesteuerte Automationen', '0/2 aktiv', false)}
  </div>

  ${section('Schnellaktionen', 'Häufige Aufgaben ohne Umwege')}
  <div class="claudian-dashboard-actions">
    ${actionBtn('search', 'Vault-RAG indexieren')}
    ${actionBtn('users', 'Multi-Agent starten', true)}
    ${actionBtn('folder-kanban', 'Neues Projekt')}
    ${actionBtn('scroll-text', 'Missions-Log')}
    ${actionBtn('gauge', 'Token-Verbrauch')}
    ${actionBtn('layout-dashboard', 'Artefakte')}
    ${actionBtn('refresh-cw', 'Aktualisieren')}
  </div>
</div>`;

const ICON_CODE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const ICON_PEN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

const modeToggle = (active) => `
  <div class="claudian-mode-toggle" role="group" aria-label="Workspace-Modus">
    <div class="claudian-mode-toggle-thumb" style="transform: translateX(${active === 'work' ? '100%' : '0'})"></div>
    <button class="claudian-mode-toggle-segment${active === 'code' ? ' is-active' : ''}" data-mode="code" type="button"><span class="claudian-mode-toggle-icon">${ICON_CODE}</span><span class="claudian-mode-toggle-label">Code</span></button>
    <button class="claudian-mode-toggle-segment${active === 'work' ? ' is-active' : ''}" data-mode="work" type="button"><span class="claudian-mode-toggle-icon">${ICON_PEN}</span><span class="claudian-mode-toggle-label">Work</span></button>
  </div>`;

const chatSurface = (mode) => `
<div class="claudian-container claudian-mode-${mode}" data-provider="claude" style="max-width:760px;margin:0 auto;">
  <div class="claudian-header">
    <div class="claudian-title-slot">
      <span class="claudian-logo"></span>
      <h4 class="claudian-title-text">ayontclaudian</h4>
      <span class="claudian-title-divider">⟋</span>
      <span class="claudian-title-chat">Kimi K3 Timeout-Fix</span>
      ${modeToggle(mode)}
    </div>
    <div class="claudian-header-actions">
      <div class="claudian-header-btn" aria-label="Neuer Tab"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></div>
      <div class="claudian-header-btn" aria-label="Chat-Verlauf"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
    </div>
  </div>
  <div style="padding:20px;">
  <div class="claudian-message claudian-message-user">
    <details class="claudian-vault-context-card">
      <summary class="claudian-vault-context-summary"><span class="claudian-vault-context-icon">${icon('brain', 14)}</span><span class="claudian-vault-context-title">2 Vault-Quellen · 1 Erinnerung</span><span class="claudian-vault-context-hint">anzeigen</span></summary>
    </details>
    <div class="claudian-context-sources">
      <span class="claudian-context-sources-label">Quellen</span>
      <button class="claudian-context-source-chip">Performance-Architektur</button>
      <button class="claudian-context-source-chip">Veylor Backend-Audit</button>
    </div>
    <div class="claudian-message-content">Wie bleibt der Antwortpfad schnell?</div>
  </div>
  <div class="claudian-message claudian-message-assistant">
    <div class="claudian-message-content">
      <details class="claudian-tool-run-group is-running" open>
        <summary class="claudian-tool-run-summary">
          <span class="claudian-tool-run-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>
          <span class="claudian-tool-run-title">Aktivität<span class="claudian-tool-run-breakdown">3× Bash · 2× Read · 1× Edit</span></span>
          <span class="claudian-tool-run-status"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg></span>
          <span class="claudian-tool-run-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></span>
        </summary>
        <div class="claudian-tool-run-body">
          <div class="claudian-tool-call">
            <div class="claudian-tool-header"><span class="claudian-tool-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/></svg></span><span class="claudian-tool-name">Bash</span><span class="claudian-tool-summary">npm run typecheck</span></div>
          </div>
          <div class="claudian-tool-call">
            <div class="claudian-tool-header"><span class="claudian-tool-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/></svg></span><span class="claudian-tool-name">Read</span><span class="claudian-tool-summary">InputController.ts</span></div>
          </div>
        </div>
      </details>
<div class="claudian-code-wrapper">
        <div class="claudian-code-header">
          <div class="claudian-code-identity"><span class="claudian-code-lang">typescript</span><span class="claudian-code-lines">5 Zeilen</span></div>
          <div class="claudian-code-actions"><button class="claudian-code-copy">Kopieren</button></div>
        </div>
        <div class="claudian-code-body has-line-numbers">
          <div class="claudian-code-gutter"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          <pre><code>export function getKimiModelContextWindow(model: string): number {
  const { models } = readKimiConfiguredModels();
  const match = models.find((entry) =&gt; entry.id === model);
  return match?.contextWindow ?? DEFAULT_KIMI_CONTEXT_WINDOW;
}</code></pre>
        </div>
      </div>
      <div class="claudian-tool-call claudian-tool-call-bash expanded">
        <div class="claudian-tool-header"><span class="claudian-tool-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span><span class="claudian-tool-name">Bash</span><span class="claudian-tool-summary">npm test</span></div>
        <div class="claudian-tool-content">
          <div class="claudian-tool-bash-panel">
            <div class="claudian-tool-bash-shell"><span class="claudian-tool-bash-prompt">❯</span><div class="claudian-tool-bash-command">npm test 2&gt;&amp;1 | tail -3</div></div>
            <div class="claudian-tool-bash-output"><div class="claudian-tool-lines"><div class="claudian-tool-line">Tests:       6715 passed, 6715 total</div><div class="claudian-tool-line">Snapshots:   0 total</div><div class="claudian-tool-line">Time:        4.2 s</div></div></div>
          </div>
        </div>
      </div>
      <div class="claudian-write-edit-block">
        <div class="claudian-write-edit-header">
          <span class="claudian-write-edit-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
          <span class="claudian-write-edit-name">Edit</span>
          <span class="claudian-write-edit-summary">src/features/chat/ui/MissionBoard.ts</span>
          <span class="claudian-write-edit-stats">+12 −3</span>
        </div>
        <div class="claudian-write-edit-content">
          <div class="claudian-write-edit-diff-row"><div class="claudian-write-edit-diff"><div class="claudian-diff-line claudian-diff-delete"><span class="claudian-diff-prefix">-</span>  row.statusEl.setText(status);</div><div class="claudian-diff-line claudian-diff-add"><span class="claudian-diff-prefix">+</span>  row.statusEl.setText(statusLabel + failover);</div></div></div>
        </div>
      </div>
      <div class="claudian-mission-board">
        <div class="claudian-mission-board-header">
          <div class="claudian-mission-board-title"><span class="claudian-mission-board-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg></span><span>Team-Mission</span></div>
          <div class="claudian-mission-board-task">Analysiere das Veylor-Plugin auf Bugs und priorisiere sie nach Schwere.</div>
          <div class="claudian-mission-board-overall"><div class="claudian-mission-board-overall-fill" style="transform: scaleX(0.55)"></div></div>
        </div>
        <div class="claudian-mission-board-blobs"><div class="claudian-mission-board-blob-row"><div class="claudian-mission-board-blob is-done" style="--mission-agent-color:#60a5fa"><div class="claudian-mission-board-blob-circle">C</div><div class="claudian-mission-board-blob-label">Codex</div></div><div class="claudian-mission-board-blob is-running" style="--mission-agent-color:#d97757"><div class="claudian-mission-board-blob-circle">F</div><div class="claudian-mission-board-blob-label">Fable</div></div><div class="claudian-mission-board-blob is-pending" style="--mission-agent-color:#a78bfa"><div class="claudian-mission-board-blob-circle">O</div><div class="claudian-mission-board-blob-label">Opus</div></div></div><div class="claudian-mission-board-flow"><div class="claudian-mission-board-flow-dot is-active" style="--mission-agent-color:#d97757"></div><div class="claudian-mission-board-flow-dot is-active" style="--mission-agent-color:#60a5fa; animation-delay:600ms"></div></div><div class="claudian-mission-board-hub is-pending"><span class="claudian-mission-board-hub-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg></span><span class="claudian-mission-board-hub-label">Synthese</span></div></div>
        <div class="claudian-mission-board-list">
          <div class="claudian-mission-board-row is-done">
            <div class="claudian-mission-board-identity"><span class="claudian-mission-board-dot"></span><span class="claudian-mission-board-name">Codex</span><span class="claudian-mission-board-meta">codex · gpt-5.2-codex</span></div>
            <div class="claudian-mission-board-status">Fertig</div>
            <div class="claudian-mission-board-track"><div class="claudian-mission-board-fill" style="transform: scaleX(1)"></div></div>
            <div class="claudian-mission-board-preview">…ReentrantLock fehlt in BazaarOrderService.matchOrders — Race bei parallelen Instant-Buys.</div>
          </div>
          <div class="claudian-mission-board-row is-running">
            <div class="claudian-mission-board-identity"><span class="claudian-mission-board-dot"></span><span class="claudian-mission-board-name">Fable</span><span class="claudian-mission-board-meta">claude · fable</span></div>
            <div class="claudian-mission-board-status">Arbeitet…</div>
            <div class="claudian-mission-board-track"><div class="claudian-mission-board-fill" style="transform: scaleX(0.62)"></div></div>
            <div class="claudian-mission-board-preview">…prüfe die Economy-Pfade: withdraw vor deposit ist überall eingehalten, aber der Voucher-…</div>
          </div>
          <div class="claudian-mission-board-row is-pending">
            <div class="claudian-mission-board-identity"><span class="claudian-mission-board-dot"></span><span class="claudian-mission-board-name">Opus</span><span class="claudian-mission-board-meta">claude · opus-4.8</span></div>
            <div class="claudian-mission-board-status">Bereit</div>
            <div class="claudian-mission-board-track"><div class="claudian-mission-board-fill"></div></div>
            <div class="claudian-mission-board-preview"></div>
          </div>
        </div>
        <div class="claudian-mission-board-synthesis">
          <div class="claudian-mission-board-synth-head"><span class="claudian-mission-board-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg></span><span>Synthese</span></div>
          <div class="claudian-mission-board-synth-output">Kombiniere die Befunde: 3 kritische Bugs (Bazaar-Race, Voucher-Dupe, …), 5 mittlere…</div>
        </div>
      </div>
            <p>Der Preflight läuft parallel: Graph-Kontext überlappt Memory und RAG, die Undo-Baseline liest in Stapeln, und die PATH-Auflösung ist memoisiert.</p>
      <div class="claudian-diff-block claudian-diff-del">The quick <mark class="claudian-diff-word claudian-diff-word-del">brown</mark> fox.</div>
      <div class="claudian-diff-block claudian-diff-ins">The quick <mark class="claudian-diff-word claudian-diff-word-ins">red</mark> fox.</div>
      <div class="claudian-tool-call">
        <div class="claudian-tool-web-badge is-done"><span><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Websuche fertig</span></div>
        <div class="claudian-web-query">T3 Code chat UI</div>
        <div class="claudian-tool-lines claudian-web-results">
          <a class="claudian-tool-link" href="https://t3.codes"><span class="claudian-tool-link-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span><span class="claudian-web-result-copy"><span class="claudian-web-result-domain">t3.codes</span><span class="claudian-tool-link-title">T3 Code — control plane for coding agents</span></span></a>
          <a class="claudian-tool-link" href="https://t3.chat"><span class="claudian-tool-link-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span><span class="claudian-web-result-copy"><span class="claudian-web-result-domain">t3.chat</span><span class="claudian-tool-link-title">T3 Chat</span></span></a>
        </div>
      </div>
    </div>
  </div>
  <div class="claudian-input-container">
    <div class="claudian-mode-quick-row"><div class="claudian-mode-quick-group claudian-mode-quick-group--code"><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Bugs finden</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Änderungen reviewen</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Build &amp; Tests</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Refactoring</span></button></div><div class="claudian-mode-quick-group claudian-mode-quick-group--work"><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Dokument erstellen</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Notiz strukturieren</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>E-Mail schreiben</span></button><button class="claudian-mode-quick-chip" type="button"><span class="claudian-mode-quick-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span>Vault-Recherche</span></button></div></div>
    <div class="claudian-input-wrapper">
      <textarea class="claudian-input" rows="3" placeholder="${mode === 'work' ? 'Woran arbeiten wir?' : 'Was bauen wir?'}"></textarea>
    </div>
  </div>
  </div>
</div>`;

const chat = chatSurface('code');
const chatWork = chatSurface('work');

const modal = `
<div class="claudian-container">
  <div class="claudian-new-project-modal" style="max-width:520px;margin:24px auto;padding:20px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:12px;">
    <h2 class="claudian-new-project-title">New project</h2>
    <p class="claudian-new-project-subtitle">Projects bundle instructions, skills and memories for one work context.</p>
    <div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">Name</div><div class="setting-item-description">Required. Determines the project folder and file name.</div></div><div class="setting-item-control"><input type="text" placeholder="e.g. Veylor Backend"></div></div>
    <div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">Description</div><div class="setting-item-description">Optional. What is this project for?</div></div><div class="setting-item-control"><textarea rows="2" placeholder="Short description …"></textarea></div></div>
    <div class="claudian-new-project-actions"><button>Cancel</button><button class="mod-cta">Create project</button></div>
  </div>
</div>`;

// Chrome surface: everything around the transcript — welcome screen, tab
// badges, thinking states, history dropdown — so the frame gets design
// iteration too, not just messages.
const chrome = `
<div class="claudian-container" data-provider="claude" style="max-width:760px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:28px;">
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">TAB BADGES</div>
    <div class="claudian-tab-badges">
      <div class="claudian-tab-badge claudian-tab-badge-active" data-provider="claude">1</div>
      <div class="claudian-tab-badge claudian-tab-badge-streaming" data-provider="kimi">2</div>
      <div class="claudian-tab-badge" data-provider="codex">3</div>
      <div class="claudian-tab-badge" data-provider="grok">4</div>
    </div>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">COMPOSER TOOLBAR</div>
    <div class="claudian-input-wrapper" style="max-width:720px;">
      <div class="claudian-input-toolbar">
        <button class="claudian-model-btn" data-provider="kimi" type="button"><span class="claudian-model-provider-mark"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg></span><span class="claudian-model-label">K3</span><span class="claudian-model-provider-name">Kimi</span></button>
        <div class="claudian-thinking-selector">
          <div class="claudian-thinking-effort"><span class="claudian-thinking-label-text">Effort:</span><div class="claudian-thinking-gears"><div class="claudian-thinking-current">Hoch</div></div></div>
        </div>
        <div class="claudian-mode-selector"><span class="claudian-mode-label">Thinking</span><div class="claudian-toggle-switch active"></div></div>
        <span style="font-size:var(--cl-text-xs);color:var(--text-muted);">≈7%</span>
        <div class="claudian-permission-toggle"><span class="claudian-permission-label auto-active">AUTO</span><div class="claudian-toggle-switch active auto"></div></div>
        <div class="claudian-service-tier-toggle"><button class="claudian-service-tier-button" type="button"><span class="claudian-service-tier-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg></span></button></div>
        <div class="claudian-os-actions">
          <button class="claudian-command-center-trigger" type="button"><span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg></span></button>
          <button class="claudian-os-action-button" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
          <button class="claudian-os-action-button is-active" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.4c2.9.6 5.5 2.7 5.5 5.6"/></svg></button>
          <button class="claudian-os-action-button" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></button>
          <button class="claudian-os-action-button" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
        </div>
        <span class="claudian-composer-hint">⌘↵</span>
        <button class="claudian-send-btn is-ready" type="button" aria-label="Senden"><span class="claudian-send-btn-icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></span></button>
      </div>
      <textarea class="claudian-input" rows="2" placeholder="Was bauen wir?"></textarea>
    </div>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">VERBRAUCH &amp; LIMITS</div>
    <div style="max-width:560px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:12px;padding:16px;">
      <div class="claudian-usage-totals">
        <div class="claudian-usage-total-card"><span class="claudian-usage-total-label">Heute</span><span class="claudian-usage-total-value">48,2k</span></div>
        <div class="claudian-usage-total-card"><span class="claudian-usage-total-label">7 Tage</span><span class="claudian-usage-total-value">312k</span></div>
        <div class="claudian-usage-total-card"><span class="claudian-usage-total-label">Session</span><span class="claudian-usage-total-value">12,7k</span></div>
      </div>
      <div class="claudian-usage-provider-card">
        <div class="claudian-usage-provider-head"><span class="claudian-usage-provider-name">Claude</span>
          <div class="claudian-usage-editors">
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Fenster</span><input class="claudian-usage-editor-input" type="number" value="5"><span class="claudian-usage-editor-suffix">h</span></span>
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Limit</span><input class="claudian-usage-editor-input" type="number" value="100000"><span class="claudian-usage-editor-suffix">Tokens</span></span>
          </div>
        </div>
        <div class="claudian-usage-consumption"><span class="claudian-usage-consumption-value">38,4k / 100k Tokens</span><span class="claudian-usage-consumption-sub">38% im 5-h-Fenster · noch 61,6k</span></div>
        <div class="claudian-usage-limit-bar"><div class="claudian-usage-limit-fill" style="width:38%"></div></div>
        <div class="claudian-usage-provider-meta"><span class="claudian-usage-reset-chip">↻ Reset in 2 h 14 min</span><span class="claudian-usage-provider-sums">Heute 38,4k · 7 Tage 210k</span></div>
      </div>
      <div class="claudian-usage-provider-card">
        <div class="claudian-usage-provider-head"><span class="claudian-usage-provider-name">Kimi</span>
          <div class="claudian-usage-editors">
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Fenster</span><input class="claudian-usage-editor-input" type="number" value="5"><span class="claudian-usage-editor-suffix">h</span></span>
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Limit</span><input class="claudian-usage-editor-input" type="number" placeholder="aus"><span class="claudian-usage-editor-suffix">Tokens</span></span>
          </div>
        </div>
        <div class="claudian-usage-consumption"><span class="claudian-usage-consumption-value">9,8k Tokens</span><span class="claudian-usage-consumption-sub">im 5-h-Fenster · 14 Turns</span></div>
        <div class="claudian-usage-provider-meta"><span class="claudian-usage-reset-chip">↻ Reset in 43 min</span><span class="claudian-usage-provider-sums">Heute 9,8k · 7 Tage 102k</span></div>
      </div>
      <div class="claudian-usage-provider-card">
        <div class="claudian-usage-provider-head"><span class="claudian-usage-provider-name">Codex</span>
          <div class="claudian-usage-editors">
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Fenster</span><input class="claudian-usage-editor-input" type="number" value="5"><span class="claudian-usage-editor-suffix">h</span></span>
            <span class="claudian-usage-editor"><span class="claudian-usage-editor-label">Limit</span><input class="claudian-usage-editor-input" type="number" value="50000"><span class="claudian-usage-editor-suffix">Tokens</span></span>
          </div>
        </div>
        <div class="claudian-usage-consumption"><span class="claudian-usage-consumption-value">43,5k / 50k Tokens</span><span class="claudian-usage-consumption-sub">87% im 5-h-Fenster · noch 6,5k</span></div>
        <div class="claudian-usage-limit-bar"><div class="claudian-usage-limit-fill is-warn" style="width:87%"></div></div>
        <div class="claudian-usage-provider-meta"><span class="claudian-usage-reset-chip">↻ Reset in 1 h 2 min</span><span class="claudian-usage-provider-sums">Heute 43,5k · 7 Tage 88k</span></div>
      </div>
    </div>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">WELCOME</div>
    <div class="claudian-welcome" style="min-height:220px;">
      <div class="claudian-welcome-greeting">Guten Abend, Niccolo</div>
      <div class="claudian-welcome-sub claudian-welcome-sub--code">Code-Modus · Dein Vault ist das Arbeitsverzeichnis</div>
      <div class="claudian-welcome-sub claudian-welcome-sub--work">Work-Modus · Dokumente, Notizen, Recherche</div>
      <div class="claudian-welcome-starters">
        <div class="claudian-welcome-starter-group claudian-welcome-starter-group--code">
          <button class="claudian-welcome-starter" type="button"><span class="claudian-welcome-starter-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span class="claudian-welcome-starter-label">Bugs finden</span></button>
          <button class="claudian-welcome-starter" type="button"><span class="claudian-welcome-starter-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span class="claudian-welcome-starter-label">Änderungen reviewen</span></button>
          <button class="claudian-welcome-starter" type="button"><span class="claudian-welcome-starter-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span class="claudian-welcome-starter-label">Build &amp; Tests</span></button>
          <button class="claudian-welcome-starter" type="button"><span class="claudian-welcome-starter-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg></span><span class="claudian-welcome-starter-label">Refactoring</span></button>
        </div>
      </div>
    </div>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">THINKING</div>
    <div class="claudian-thinking">Denkt nach<span class="claudian-thinking-hint">12s</span></div>
    <details class="claudian-thinking-block" open>
      <summary class="claudian-thinking-summary">Reasoning</summary>
      <div class="claudian-thinking-content">Der Watchdog misst Chunk-Stille — bei Kimi K3 kommen während langer Reasoning-Phasen keine Bytes, also braucht es einen Keepalive.</div>
    </details>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">HISTORY MENU</div>
    <div class="claudian-history-menu visible" style="position:static;">
      <div class="claudian-history-header">
        <div class="claudian-history-header-top"><span>Chats</span><span class="claudian-history-header-count">24</span></div>
        <div class="claudian-history-search"><span class="claudian-history-search-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span><input class="claudian-history-search-input" placeholder="Suchen…"></div>
      </div>
      <div class="claudian-history-list">
        <div class="claudian-history-group">Heute</div>
        <div class="claudian-history-item active"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="claudian-history-item-title">Kimi K3 Timeout-Fix</span></div>
        <div class="claudian-history-group">Gestern</div>
        <div class="claudian-history-item"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="claudian-history-item-title">Workspace-Modus Design</span></div>
        <div class="claudian-history-item"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="claudian-history-item-title">Bazaar Order-Book Review</span></div>
      </div>
    </div>
  </div>
</div>`;

const SURFACES = { Dashboard: dashboard, Chat: chat, 'Chat (Work)': chatWork, Chrome: chrome, 'New Project': modal };

const tabs = Object.keys(SURFACES)
  .map((name, i) => `<button class="pv-tab${i === 0 ? ' is-active' : ''}" data-surface="${name}">${name}</button>`)
  .join('');
const panels = Object.entries(SURFACES)
  .map(([name, html], i) => `<div class="pv-panel${i === 0 ? ' is-active' : ''}" data-surface="${name}">${html}</div>`)
  .join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claudian — Design Preview</title>
<style>${THEME_SHIM}
.pv-bar { position: sticky; top: 0; z-index: 50; display: flex; gap: 6px; align-items: center; padding: 10px 14px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); }
.pv-tab { padding: 6px 12px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 13px; }
.pv-tab.is-active { background: var(--background-modifier-hover); color: var(--text-normal); border-color: var(--background-modifier-border); }
.pv-spacer { flex: 1; }
.pv-panel { display: none; padding: 8px; }
.pv-panel.is-active { display: block; }
</style>
<style>${pluginCss}</style>
</head>
<body class="theme-dark">
<div class="pv-bar">
  ${tabs}
  <span class="pv-spacer"></span>
  <button class="pv-tab" id="pv-theme">Theme wechseln</button>
</div>
${panels}
<script>
  const tabs = document.querySelectorAll('.pv-tab[data-surface]');
  const panels = document.querySelectorAll('.pv-panel');
  tabs.forEach(t => t.addEventListener('click', () => {
    const name = t.dataset.surface;
    tabs.forEach(x => x.classList.toggle('is-active', x === t));
    panels.forEach(p => p.classList.toggle('is-active', p.dataset.surface === name));
  }));
  document.getElementById('pv-theme').addEventListener('click', () => {
    document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light');
  });
  // Headless-friendly deep links: #<surface-slug>[.light] activates a surface
  // (and optionally the light theme) without clicks, e.g. #chat-work.light
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) {
    const [surfaceSlug, theme] = hash.split('.');
    panels.forEach(p => {
      const match = slug(p.dataset.surface) === surfaceSlug;
      p.classList.toggle('is-active', match);
    });
    tabs.forEach(t => t.classList.toggle('is-active', slug(t.dataset.surface) === surfaceSlug));
    if (theme === 'light') {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
    }
  }
</script>
</body>
</html>`;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf-8');
console.log(`[preview] wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB) — open it in a browser.`);

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

// ── Mock helpers (mirror the real DOM classes) ───────────────────────────────
const statCard = (status, action, value, title, subtitle) => `
  <div class="claudian-dashboard-card claudian-dashboard-card--${status}" role="button" tabindex="0">
    <div class="claudian-dashboard-card-header">
      <span class="claudian-dashboard-card-icon"></span>
      <span class="claudian-dashboard-card-action">${action}</span>
    </div>
    <div class="claudian-dashboard-card-value">${value}</div>
    <h3 class="claudian-dashboard-card-title">${title}</h3>
    <p class="claudian-dashboard-card-subtitle">${subtitle}</p>
  </div>`;

const capability = (label, state, supported) => `
  <div class="claudian-dashboard-capability${supported ? ' is-supported' : ''}">
    <span class="claudian-dashboard-capability-icon"></span>
    <div class="claudian-dashboard-capability-copy">
      <span class="claudian-dashboard-capability-label">${label}</span>
      <span class="claudian-dashboard-capability-state">${state}</span>
    </div>
    <span class="claudian-dashboard-capability-check"></span>
  </div>`;

const feature = (label, detail, value, active) => `
  <div class="claudian-dashboard-feature${active ? ' is-active' : ''}" role="listitem">
    <span class="claudian-dashboard-feature-icon"></span>
    <div class="claudian-dashboard-feature-copy">
      <span class="claudian-dashboard-feature-label">${label}</span>
      <span class="claudian-dashboard-feature-detail">${detail}</span>
    </div>
    <span class="claudian-dashboard-feature-value">${value}</span>
  </div>`;

const actionBtn = (label, primary = false) =>
  `<button class="claudian-dashboard-action-btn${primary ? ' claudian-dashboard-action-btn--primary' : ''}"><span></span><span>${label}</span></button>`;

const section = (title, detail) =>
  `<div class="claudian-dashboard-section-heading"><h3>${title}</h3><span>${detail}</span></div>`;

// ── Surfaces ─────────────────────────────────────────────────────────────────
const dashboard = `
<div class="claudian-dashboard" data-provider="claude">
  <div class="claudian-dashboard-header">
    <div class="claudian-dashboard-title-group">
      <span class="claudian-dashboard-logo"></span>
      <div class="claudian-dashboard-text-group">
        <h2>Claudian OS</h2>
        <p>Agent workspace for your vault</p>
      </div>
    </div>
    <div class="claudian-dashboard-status">
      <span class="claudian-dashboard-provider-chip" data-provider="claude"><span class="claudian-dashboard-provider-dot"></span><span>Claude</span></span>
      <span class="claudian-dashboard-status-dot claudian-dashboard-status-dot--active"></span>
      <span class="claudian-dashboard-live">Active</span>
    </div>
  </div>

  ${section('System overview', 'Live state of your agent workspace')}
  <div class="claudian-dashboard-grid">
    ${statCard('info', 'Create', '3', 'Projects', 'Latest: Veylor Backend')}
    ${statCard('ok', 'Browse', '17', 'Memory', 'Latest: Performance architecture')}
    ${statCard('warning', 'Reset', '130,144', 'Token usage', 'Session: 130,144 tokens')}
    ${statCard('ok', 'Index', '1,960', 'RAG index', 'Vault chunks indexed')}
    ${statCard('info', 'View', '2', 'Workflows', 'Scheduled automations')}
    ${statCard('accent', 'Run', '20', 'Agents', 'Specialist agents ready')}
  </div>

  ${section('Provider capabilities', 'What your active runtime provider supports directly')}
  <div class="claudian-dashboard-capabilities">
    <div class="claudian-dashboard-provider-rail">
      <span class="claudian-dashboard-provider-rail-label">Enabled providers</span>
      <div class="claudian-dashboard-provider-list">
        <span class="claudian-dashboard-provider-item" data-provider="opencode"><span class="claudian-dashboard-provider-item-dot"></span><span>OpenCode</span></span>
        <span class="claudian-dashboard-provider-item" data-provider="kimi"><span class="claudian-dashboard-provider-item-dot"></span><span>Kimi</span></span>
        <span class="claudian-dashboard-provider-item is-active" data-provider="claude"><span class="claudian-dashboard-provider-item-dot"></span><span>Claude</span><span class="claudian-dashboard-provider-item-current">active</span></span>
      </div>
    </div>
    <div class="claudian-dashboard-capability-grid">
      ${capability('Images & Vision', 'Available', true)}
      ${capability('Plan Mode', 'Available', true)}
      ${capability('MCP Tools', 'Available', true)}
      ${capability('Multi-Agent', 'Available', true)}
      ${capability('Rewind', 'Available', true)}
      ${capability('Fork', 'Available', true)}
      ${capability('Instructions', 'Available', true)}
      ${capability('Live Steering', 'Not supported', false)}
    </div>
  </div>

  ${section('Feature map', 'Your key Claudian systems at a glance')}
  <div class="claudian-dashboard-feature-map" role="list">
    ${feature('Model Router', 'Picks the best model automatically', 'Off', false)}
    ${feature('Agent Memory', 'Remembers project-scoped facts', 'Active', true)}
    ${feature('Vault RAG', 'Semantic context from your vault', '1960 chunks', true)}
    ${feature('Vision', 'Analyzes images and screenshots', 'Ready', true)}
    ${feature('Auto Mode', 'Continues long goals unattended', 'Active', true)}
    ${feature('Diff Preview', 'Shows changes before applying', 'Active', true)}
    ${feature('Token Guard', 'Watches session and daily budget', 'Off', false)}
    ${feature('Workflows', 'Time- and event-driven automations', '0/2 active', false)}
  </div>

  ${section('Quick actions', 'Common tasks without detours')}
  <div class="claudian-dashboard-actions">
    ${actionBtn('Index Vault RAG')}
    ${actionBtn('Run Multi-Agent', true)}
    ${actionBtn('New Project')}
    ${actionBtn('Mission Log')}
    ${actionBtn('Token Usage')}
    ${actionBtn('Artifacts')}
    ${actionBtn('Refresh')}
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
      <div class="claudian-header-btn" aria-label="New tab"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></div>
      <div class="claudian-header-btn" aria-label="History"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
    </div>
  </div>
  <div style="padding:20px;">
  <div class="claudian-message claudian-message-user">
    <details class="claudian-vault-context-card">
      <summary class="claudian-vault-context-summary"><span class="claudian-vault-context-icon"></span><span class="claudian-vault-context-title">2 Vault sources · 1 memory</span><span class="claudian-vault-context-hint">show</span></summary>
    </details>
    <div class="claudian-context-sources">
      <span class="claudian-context-sources-label">Sources</span>
      <button class="claudian-context-source-chip">Performance architecture</button>
      <button class="claudian-context-source-chip">Veylor backend audit</button>
    </div>
    <div class="claudian-message-content">How does the response path stay fast?</div>
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
          <div class="claudian-code-identity"><span class="claudian-code-lang">typescript</span><span class="claudian-code-lines">12 Zeilen</span></div>
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
            <p>The preflight is parallelized: graph context overlaps memory and RAG, the undo baseline reads in batches, and PATH resolution is memoized.</p>
      <div class="claudian-diff-block claudian-diff-del">The quick <mark class="claudian-diff-word claudian-diff-word-del">brown</mark> fox.</div>
      <div class="claudian-diff-block claudian-diff-ins">The quick <mark class="claudian-diff-word claudian-diff-word-ins">red</mark> fox.</div>
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
      </div>
      <textarea class="claudian-input" rows="2" placeholder="Was bauen wir?"></textarea>
    </div>
  </div>
  <div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">WELCOME</div>
    <div class="claudian-welcome" style="min-height:120px;">
      <div class="claudian-welcome-greeting">Guten Abend, Niccolo</div>
      <div class="claudian-welcome-sub claudian-welcome-sub--code">Code-Modus · Dein Vault ist das Arbeitsverzeichnis</div>
      <div class="claudian-welcome-sub claudian-welcome-sub--work">Work-Modus · Dokumente, Notizen, Recherche</div>
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
      <div class="claudian-history-item active"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span>Kimi K3 Timeout-Fix</span></div>
      <div class="claudian-history-item"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span>Workspace-Modus Design</span></div>
      <div class="claudian-history-item"><span class="claudian-history-item-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span>Bazaar Order-Book Review</span></div>
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
  <button class="pv-tab" id="pv-theme">Toggle theme</button>
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

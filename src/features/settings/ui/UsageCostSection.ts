import { setIcon } from 'obsidian';

import { formatCapacityReset } from '../../../core/budget/providerCapacity';
import {
  type CostSettings,
  DEFAULT_COST_CURRENCY,
  formatCost,
  formatTokens,
  getProviderCostConfig,
  type ProviderBillingMode,
  type ProviderCostSummary,
  RATE_WILDCARD,
  summarizeProviderCost,
} from '../../../core/budget/providerPricing';
import { DEFAULT_USAGE_WINDOW_HOURS,type ProviderWindow, type TokenBudgetSettings } from '../../../core/budget/tokenBudget';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/types/provider';
import type ClaudianPlugin from '../../../main';
import { animateCount, renderSparkline } from './usageCostVisuals';

type PeriodId = 'today' | 'week' | 'month';

interface Period {
  id: PeriodId;
  label: string;
  days: number;
}

const PERIODS: Period[] = [
  { id: 'today', label: 'Heute', days: 1 },
  { id: 'week', label: '7 Tage', days: 7 },
  { id: 'month', label: '30 Tage', days: 30 },
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

/**
 * Usage & cost center.
 *
 * One surface that answers "what did this cost and how much room is left" for
 * EVERY provider — including ones with no usage yet, because a provider missing
 * from the list reads as broken rather than idle.
 *
 * Costs are honest by construction: subscription providers show their plan price
 * and the effective price per million tokens they actually delivered; metered
 * providers show real spend only where the user configured a rate, and say so
 * where they did not (see `providerPricing`).
 */
export function renderUsageCostSection(
  container: HTMLElement,
  plugin: ClaudianPlugin,
): void {
  const root = container.createDiv({ cls: 'claudian-usage-center' });
  let period: PeriodId = 'month';
  const expanded = new Set<string>();

  const rerender = (): void => {
    root.empty();
    renderHeader(root, plugin, period, (next) => {
      period = next;
      rerender();
    });
    renderBody(root, plugin, currentPeriod(period), expanded, rerender);
  };

  rerender();
}

function currentPeriod(id: PeriodId): Period {
  return PERIODS.find((entry) => entry.id === id) ?? PERIODS[2];
}

function renderHeader(
  root: HTMLElement,
  plugin: ClaudianPlugin,
  active: PeriodId,
  onPeriodChange: (period: PeriodId) => void,
): void {
  const head = root.createDiv({ cls: 'claudian-usage-center-head' });

  const copy = head.createDiv({ cls: 'claudian-usage-center-copy' });
  const eyebrow = copy.createDiv({ cls: 'claudian-usage-center-eyebrow' });
  setIcon(eyebrow.createSpan(), 'wallet');
  eyebrow.createSpan({ text: 'Verbrauch & Kosten' });
  copy.createEl('h3', { cls: 'claudian-usage-center-title', text: 'Alle Provider auf einen Blick' });

  const switcher = head.createDiv({ cls: 'claudian-usage-period' });
  for (const entry of PERIODS) {
    const button = switcher.createEl('button', {
      cls: `claudian-usage-period-btn${entry.id === active ? ' is-active' : ''}`,
      text: entry.label,
    });
    button.setAttribute('aria-pressed', String(entry.id === active));
    button.addEventListener('click', () => onPeriodChange(entry.id));
  }
}

function renderBody(
  root: HTMLElement,
  plugin: ClaudianPlugin,
  period: Period,
  expanded: Set<string>,
  rerender: () => void,
): void {
  const settings = plugin.settings as unknown as CostSettings & Record<string, unknown>;
  const currency = settings.costCurrency ?? DEFAULT_COST_CURRENCY;
  const now = Date.now();
  const since = startOfPeriod(period, now);

  const providerIds = collectProviderIds(plugin);
  const summaries = providerIds.map((providerId) => {
    const config = getProviderCostConfig(settings, providerId);
    return summarizeProviderCost({
      config,
      events: plugin.tokenBudgetTracker.getEvents({ providerId, since }),
      proratedDays: period.days,
      providerId,
    });
  });

  renderTotals(root, summaries, currency, period);
  renderWindowsAndBudgets(root, plugin, now);

  const grid = root.createDiv({ cls: 'claudian-usage-center-grid' });
  const ordered = [...summaries].sort((a, b) => b.tokens - a.tokens);
  ordered.forEach((summary, index) => {
    renderProviderCard({
      currency,
      expanded,
      grid,
      index,
      now,
      period,
      plugin,
      rerender,
      summary,
    });
  });

  renderFooter(root, plugin, currency, rerender);
}

/** Every registered provider, plus any that recorded usage but is no longer registered. */
function collectProviderIds(plugin: ClaudianPlugin): string[] {
  const registered = ProviderRegistry.getRegisteredProviderIds() as string[];
  const seen = plugin.tokenBudgetTracker.getSeenProviderIds();
  return [...new Set([...registered, ...seen])];
}

/**
 * Rate-limit windows and the daily budget, rendered as the "usage check"
 * strip: one activity-style ring per provider whose arc is the age of its
 * current window (so the ring fills toward the reset moment), plus the
 * day-budget progress. Data comes straight from the tracker's verified APIs.
 */
function renderWindowsAndBudgets(
  root: HTMLElement,
  plugin: ClaudianPlugin,
  now: number,
): void {
  const windows = plugin.tokenBudgetTracker.getWindowedProviders({}, now).slice(0, 8);
  const settings = plugin.settings as unknown as TokenBudgetSettings;
  const budgetEnabled = settings.tokenBudgetEnabled === true;
  const budgetCap = typeof settings.dailyTokenBudget === 'number' ? settings.dailyTokenBudget : 0;
  const todayTotal = windows.reduce((sum, entry) => sum + entry.todayTokens, 0);

  const hasWindows = windows.length > 0;
  if (!hasWindows && !(budgetEnabled && budgetCap > 0)) {
    return;
  }

  if (hasWindows) {
    const strip = root.createDiv({ cls: 'claudian-usage-ringstrip' });
    for (const entry of windows) {
      strip.appendChild(renderWindowCard(entry, now));
    }
  }

  if (budgetEnabled && budgetCap > 0) {
    root.appendChild(renderBudgetCard(todayTotal, budgetCap));
  }
}

function renderWindowCard(entry: ProviderWindow, now: number): HTMLElement {
  const card = document.createElement('div');
  card.className = `claudian-usage-ringcard${entry.tokens > 0 ? '' : ' is-idle'}`;
  card.dataset.provider = entry.providerId;

  // The ring tracks window age, not a token quota — rate-limit windows have no
  // published cap to measure against, and pretending otherwise would invent a
  // number. Full arc == the oldest in-window event just left the window.
  const elapsed = DEFAULT_USAGE_WINDOW_HOURS > 0
    ? Math.min(1, Math.max(0.04, 1 - Math.max(0, (entry.resetAt ?? now) - now) / (DEFAULT_USAGE_WINDOW_HOURS * 3_600_000)))
    : 0;
  const idleArc = 0.06;

  const ring = card.createDiv({ cls: 'claudian-usage-ringcard-dial' });
  ring.style.setProperty('--ring-progress', String(entry.tokens > 0 ? elapsed : idleArc));

  const meta = card.createDiv({ cls: 'claudian-usage-ringcard-meta' });
  const name = meta.createDiv({ cls: 'claudian-usage-ringcard-name' });
  name.createSpan({ cls: 'claudian-usage-ringcard-dot' });
  name.createSpan({ text: safeProviderName(entry.providerId) });
  meta.createDiv({ cls: 'claudian-usage-ringcard-figure', text: formatTokens(entry.tokens) });
  meta.createDiv({
    cls: 'claudian-usage-ringcard-reset',
    text: entry.resetAt === null || entry.tokens === 0 ? `${entry.runs} Turns · frei` : `Reset ${formatRelativeTime(entry.resetAt, now)}`,
  });
  return card;
}

function renderBudgetCard(todayTotal: number, cap: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'claudian-usage-budget';
  const head = card.createDiv({ cls: 'claudian-usage-budget-head' });
  head.createDiv({ cls: 'claudian-usage-budget-title', text: 'Tagesbudget' });
  const fraction = cap > 0 ? Math.min(1, todayTotal / cap) : 0;
  head.createDiv({
    cls: 'claudian-usage-budget-figure',
    text: `${formatTokens(todayTotal)} / ${formatTokens(cap)} (${Math.round(fraction * 100)} %)`,
  });
  const track = card.createDiv({ cls: 'claudian-usage-budget-track' });
  const fill = track.createDiv({
    cls: `claudian-usage-budget-fill${fraction >= 1 ? ' is-over' : ''}`,
  });
  fill.style.width = `${Math.max(2, fraction * 100)}%`;
  return card;
}

function formatRelativeTime(targetMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((targetMs - now) / 60_000));
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

function startOfPeriod(period: Period, now: number): number {
  const reference = new Date(now);
  const startOfToday = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
  ).getTime();
  return startOfToday - (period.days - 1) * 24 * 60 * 60 * 1000;
}

function renderTotals(
  root: HTMLElement,
  summaries: ProviderCostSummary[],
  currency: string,
  period: Period,
): void {
  const tokens = summaries.reduce((sum, summary) => sum + summary.tokens, 0);
  const runs = summaries.reduce((sum, summary) => sum + summary.runs, 0);
  const active = summaries.filter((summary) => summary.tokens > 0).length;

  const priced = summaries.filter(
    (summary) => summary.meteredCost !== null || summary.monthlyCost !== null,
  );
  const total = priced.length === 0
    ? null
    : priced.reduce((sum, summary) => {
      if (summary.billing === 'metered') return sum + (summary.meteredCost ?? 0);
      const monthly = summary.monthlyCost ?? 0;
      return sum + (monthly / 30) * period.days;
    }, 0);

  const strip = root.createDiv({ cls: 'claudian-usage-center-totals' });
  renderTotalCard(strip, {
    accentClass: 'is-cost',
    hint: total === null ? 'Preise noch nicht hinterlegt' : `Zeitraum: ${period.label.toLowerCase()}`,
    icon: 'euro',
    label: 'Kosten',
    numeric: total,
    text: formatCost(total, currency),
  });
  renderTotalCard(strip, {
    accentClass: 'is-tokens',
    hint: `${runs.toLocaleString()} Turns`,
    icon: 'activity',
    label: 'Tokens',
    numeric: tokens,
    text: formatTokens(tokens),
  });
  renderTotalCard(strip, {
    accentClass: 'is-providers',
    hint: `${summaries.length} verfügbar`,
    icon: 'layers',
    label: 'Aktive Provider',
    numeric: active,
    text: String(active),
  });
}

function renderTotalCard(
  parent: HTMLElement,
  options: {
    accentClass: string;
    hint: string;
    icon: string;
    label: string;
    numeric: number | null;
    text: string;
  },
): void {
  const card = parent.createDiv({ cls: `claudian-usage-total ${options.accentClass}` });
  const head = card.createDiv({ cls: 'claudian-usage-total-head' });
  setIcon(head.createSpan({ cls: 'claudian-usage-total-icon' }), options.icon);
  head.createSpan({ cls: 'claudian-usage-total-label', text: options.label });

  const value = card.createDiv({ cls: 'claudian-usage-total-value', text: options.text });
  if (options.numeric !== null && options.numeric > 0) {
    animateCount(value, options.numeric, options.text);
  }
  card.createDiv({ cls: 'claudian-usage-total-hint', text: options.hint });
}

function renderProviderCard(params: {
  currency: string;
  expanded: Set<string>;
  grid: HTMLElement;
  index: number;
  now: number;
  period: Period;
  plugin: ClaudianPlugin;
  rerender: () => void;
  summary: ProviderCostSummary;
}): void {
  const { currency, expanded, grid, index, now, period, plugin, rerender, summary } = params;
  const settings = plugin.settings as unknown as CostSettings & Record<string, unknown>;
  const providerId = summary.providerId;

  const card = grid.createDiv({
    cls: `claudian-usage-provider${summary.tokens > 0 ? '' : ' is-idle'}`,
  });
  card.dataset.provider = providerId;
  card.style.setProperty('--stagger', String(index));

  // Header: identity + billing model.
  const head = card.createDiv({ cls: 'claudian-usage-provider-head' });
  const identity = head.createDiv({ cls: 'claudian-usage-provider-identity' });
  identity.createSpan({
    cls: 'claudian-usage-provider-title',
    text: safeProviderName(providerId),
  });
  identity.createSpan({
    cls: `claudian-usage-billing-badge is-${summary.billing}`,
    text: summary.billing === 'metered' ? 'Abrechnung' : 'Abo',
  });

  const toggle = head.createEl('button', { cls: 'claudian-usage-provider-toggle' });
  setIcon(toggle, expanded.has(providerId) ? 'chevron-up' : 'settings-2');
  toggle.setAttribute('aria-label', `${safeProviderName(providerId)} Kosten konfigurieren`);
  toggle.setAttribute('aria-expanded', String(expanded.has(providerId)));
  toggle.addEventListener('click', () => {
    if (expanded.has(providerId)) expanded.delete(providerId);
    else expanded.add(providerId);
    rerender();
  });

  // Primary figures.
  const figures = card.createDiv({ cls: 'claudian-usage-provider-figures' });
  const cost = summary.billing === 'metered'
    ? summary.meteredCost
    : summary.monthlyCost === null
      ? null
      : (summary.monthlyCost / 30) * period.days;
  figures.createDiv({ cls: 'claudian-usage-provider-cost', text: formatCost(cost, currency) });
  figures.createDiv({
    cls: 'claudian-usage-provider-tokens',
    text: `${formatTokens(summary.tokens)} Tokens · ${summary.runs} Turns`,
  });

  renderSparkline(
    card.createDiv({ cls: 'claudian-usage-provider-spark' }),
    plugin.tokenBudgetTracker.getDailySeries(providerId, Math.max(7, period.days), now),
  );

  renderWindow(card, plugin, providerId, now);
  renderProviderMeta(card, summary, currency);

  if (expanded.has(providerId)) {
    renderProviderEditor(card, plugin, providerId, settings, rerender);
  }
}

/** Rate-limit window consumption, with the configured cap as the denominator. */
function renderWindow(
  card: HTMLElement,
  plugin: ClaudianPlugin,
  providerId: string,
  now: number,
): void {
  const settings = plugin.settings;
  const windowHours = settings.usageWindowHours?.[providerId] ?? DEFAULT_USAGE_WINDOW_HOURS;
  const cap = settings.usageTokenCaps?.[providerId] ?? 0;
  const window = plugin.tokenBudgetTracker.getProviderWindow(providerId, windowHours, now);

  const wrap = card.createDiv({ cls: 'claudian-usage-window' });
  const label = wrap.createDiv({ cls: 'claudian-usage-window-label' });
  label.createSpan({ text: `Fenster ${windowHours} h` });
  label.createSpan({
    cls: 'claudian-usage-window-value',
    text: cap > 0
      ? `${formatTokens(window.tokens)} / ${formatTokens(cap)}`
      : formatTokens(window.tokens),
  });

  const track = wrap.createDiv({ cls: 'claudian-usage-window-track' });
  const ratio = cap > 0 ? Math.min(1, window.tokens / cap) : 0;
  const fill = track.createDiv({
    cls: `claudian-usage-window-fill${ratio >= 0.85 ? ' is-hot' : ''}`,
  });
  fill.style.width = cap > 0 ? `${Math.round(ratio * 100)}%` : '0%';

  if (window.resetAt && window.resetAt > now) {
    wrap.createSpan({
      cls: 'claudian-usage-window-reset',
      text: `frei in ${formatCapacityReset(window.resetAt, now)}`,
    });
  }
}

function renderProviderMeta(
  card: HTMLElement,
  summary: ProviderCostSummary,
  currency: string,
): void {
  const meta = card.createDiv({ cls: 'claudian-usage-provider-meta' });

  if (summary.effectiveRatePerMillion !== null) {
    meta.createSpan({
      cls: 'claudian-usage-chip',
      text: `${formatCost(summary.effectiveRatePerMillion, currency)} / 1M`,
    });
  }
  if (summary.models[0] && summary.models[0].model !== 'default') {
    meta.createSpan({ cls: 'claudian-usage-chip', text: summary.models[0].model });
  }
  if (summary.cacheTokens > 0) {
    meta.createSpan({
      cls: 'claudian-usage-chip',
      text: `Cache ${formatTokens(summary.cacheTokens)}`,
    });
  }
  if (summary.hasUnpricedEvents) {
    meta.createSpan({ cls: 'claudian-usage-chip is-warn', text: 'Preis fehlt' });
  } else if (summary.inputOnly && summary.billing === 'metered') {
    meta.createSpan({ cls: 'claudian-usage-chip is-warn', text: 'nur Input gemeldet' });
  }
}

/** Inline editor: billing model, plan price or token rates, window and cap. */
function renderProviderEditor(
  card: HTMLElement,
  plugin: ClaudianPlugin,
  providerId: string,
  settings: CostSettings & Record<string, unknown>,
  rerender: () => void,
): void {
  const config = getProviderCostConfig(settings, providerId);
  const editor = card.createDiv({ cls: 'claudian-usage-editor-panel' });

  const save = (next: Partial<typeof config>): void => {
    settings.providerCosts = {
      ...(settings.providerCosts ?? {}),
      [providerId]: { ...config, ...next },
    };
    void plugin.saveSettings();
  };

  const modeRow = editor.createDiv({ cls: 'claudian-usage-editor-row' });
  modeRow.createSpan({ cls: 'claudian-usage-editor-caption', text: 'Abrechnung' });
  const modes = modeRow.createDiv({ cls: 'claudian-usage-mode-switch' });
  for (const mode of ['subscription', 'metered'] as ProviderBillingMode[]) {
    const button = modes.createEl('button', {
      cls: `claudian-usage-mode-btn${config.billing === mode ? ' is-active' : ''}`,
      text: mode === 'subscription' ? 'Abo' : 'Pro Token',
    });
    button.addEventListener('click', () => {
      save({ billing: mode });
      rerender();
    });
  }

  if (config.billing === 'subscription') {
    numberField(editor, {
      caption: 'Plan pro Monat',
      onChange: (value) => save({ monthlyCost: value }),
      suffix: settings.costCurrency ?? DEFAULT_COST_CURRENCY,
      value: config.monthlyCost ?? 0,
    });
  } else {
    const rate = config.rates?.[RATE_WILDCARD] ?? { input: 0, output: 0 };
    const saveRate = (next: Partial<typeof rate>): void => {
      save({ rates: { ...(config.rates ?? {}), [RATE_WILDCARD]: { ...rate, ...next } } });
    };
    numberField(editor, {
      caption: 'Input / 1M',
      onChange: (value) => saveRate({ input: value }),
      suffix: settings.costCurrency ?? DEFAULT_COST_CURRENCY,
      value: rate.input,
    });
    numberField(editor, {
      caption: 'Output / 1M',
      onChange: (value) => saveRate({ output: value }),
      suffix: settings.costCurrency ?? DEFAULT_COST_CURRENCY,
      value: rate.output,
    });
    numberField(editor, {
      caption: 'Cache-Read / 1M',
      onChange: (value) => saveRate({ cacheRead: value }),
      suffix: settings.costCurrency ?? DEFAULT_COST_CURRENCY,
      value: rate.cacheRead ?? 0,
    });
  }

  numberField(editor, {
    caption: 'Fenster',
    onChange: (value) => {
      plugin.settings.usageWindowHours = {
        ...(plugin.settings.usageWindowHours ?? {}),
        [providerId]: value,
      };
      void plugin.saveSettings();
    },
    suffix: 'h',
    value: plugin.settings.usageWindowHours?.[providerId] ?? DEFAULT_USAGE_WINDOW_HOURS,
  });

  numberField(editor, {
    caption: 'Token-Limit',
    onChange: (value) => {
      plugin.settings.usageTokenCaps = {
        ...(plugin.settings.usageTokenCaps ?? {}),
        [providerId]: value,
      };
      void plugin.saveSettings();
    },
    suffix: 'Tokens',
    value: plugin.settings.usageTokenCaps?.[providerId] ?? 0,
  });
}

function numberField(
  parent: HTMLElement,
  options: { caption: string; onChange: (value: number) => void; suffix: string; value: number },
): void {
  const row = parent.createDiv({ cls: 'claudian-usage-editor-row' });
  row.createSpan({ cls: 'claudian-usage-editor-caption', text: options.caption });
  const field = row.createDiv({ cls: 'claudian-usage-editor-field' });
  const input = field.createEl('input', { cls: 'claudian-usage-editor-input' });
  input.type = 'number';
  input.min = '0';
  input.step = 'any';
  input.value = String(options.value);
  input.addEventListener('change', () => {
    const parsed = Number.parseFloat(input.value);
    options.onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  });
  field.createSpan({ cls: 'claudian-usage-editor-suffix', text: options.suffix });
}

function renderFooter(
  root: HTMLElement,
  plugin: ClaudianPlugin,
  currency: string,
  rerender: () => void,
): void {
  const footer = root.createDiv({ cls: 'claudian-usage-center-footer' });

  const currencyWrap = footer.createDiv({ cls: 'claudian-usage-currency' });
  currencyWrap.createSpan({ text: 'Währung' });
  const select = currencyWrap.createEl('select', { cls: 'claudian-usage-currency-select' });
  for (const code of CURRENCIES) {
    select.createEl('option', { text: code, value: code });
  }
  select.value = currency;
  select.addEventListener('change', () => {
    plugin.settings.costCurrency = select.value;
    void plugin.saveSettings();
    rerender();
  });

  footer.createSpan({
    cls: 'claudian-usage-center-note',
    text: 'Kosten sind Schätzungen auf Basis der hinterlegten Preise und der gemeldeten Token.',
  });

  const reset = footer.createEl('button', {
    cls: 'claudian-usage-center-reset',
    text: 'Statistik zurücksetzen',
  });
  reset.addEventListener('click', () => {
    plugin.tokenBudgetTracker.resetSession();
    plugin.tokenBudgetTracker.resetDaily();
    plugin.persistTokenUsage();
    rerender();
  });
}

function safeProviderName(providerId: string): string {
  try {
    return ProviderRegistry.getProviderDisplayName(providerId as ProviderId) ?? providerId;
  } catch {
    return providerId;
  }
}

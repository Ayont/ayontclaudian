import { type App,Notice, setIcon } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import { AUTO_MODEL_VALUE } from '../../../core/routing/modelRouterRules';
import type {
  ManagedMcpServer,
  UsageInfo,
} from '../../../core/types';
import { appendCheckIcon, appendMcpIcon, createProviderIconSvg } from '../../../shared/icons';
import { filterValidPaths, findConflictingPath, isDuplicatePath, isValidDirectoryPath, validateDirectoryPath } from '../../../utils/externalContext';
import { expandHomePath, normalizePathForFilesystem } from '../../../utils/path';
import { ModelSelectModal } from './ModelSelectModal';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: { properties: string[]; title: string }): Promise<ElectronOpenDialogResult>;
  };
}

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

function describeDirectoryValidationError(error?: string): string {
  if (error === 'Path does not exist') return 'Pfad existiert nicht';
  if (error === 'Permission denied') return 'Zugriff verweigert';
  if (error === 'Path exists but is not a directory') return 'Pfad ist kein Ordner';
  if (error?.startsWith('Cannot access path:')) {
    return `Pfad kann nicht gelesen werden:${error.slice('Cannot access path:'.length)}`;
  }
  return error || 'Pfad konnte nicht geprüft werden';
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  app: App;
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  /** Reads the global auto mode ("double YOLO") flag, if wired. */
  getAutoMode?: () => boolean;
  /** Persists the global auto mode flag, if wired. */
  onAutoModeChange?: (value: boolean) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ProviderChatUIConfig;
  getCapabilities: () => ProviderCapabilities;
  /**
   * Returns the effective model value for display, considering draft model
   * overrides like the "Auto" sentinel that are not persisted to settings.
   */
  getModelValue?: () => string;
  /**
   * When "Auto" is active and the router has picked a concrete model for the
   * last prompt, returns that model plus the reason (for the Auto chip's
   * routed-target suffix + tooltip). Returns null when Auto hasn't routed yet.
   */
  getAutoRouteInfo?: () => { model: string; reason?: string | null } | null;
}

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLButtonElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-model-selector' });
    this.render();
  }

  /** @deprecated The model picker is now a centered Obsidian modal. */
  getDropdownEl(): HTMLElement | null {
    return null;
  }

  private getAvailableModels(settingsOverride?: Record<string, unknown>) {
    const settings = settingsOverride ?? this.callbacks.getSettings();
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createEl('button', {
      cls: 'claudian-model-btn clickable-icon',
      attr: { type: 'button', 'aria-haspopup': 'dialog' },
    });
    this.buttonEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openModal();
    });
    this.updateDisplay();
  }

  /** Opens the model picker programmatically (e.g. from a per-message "switch model" action). */
  openPicker(): void {
    this.openModal();
  }

  /** Programmatically selects a model via the same path as the modal. */
  async selectModel(modelValue: string): Promise<void> {
    await this.callbacks.onModelChange(modelValue);
    this.updateDisplay();
  }

  private openModal(): void {
    const currentModel = this.callbacks.getModelValue?.() ?? this.callbacks.getSettings().model;
    const models = sortModelOptions(this.getAvailableModels(), currentModel);
    new ModelSelectModal(
      this.callbacks.app,
      models,
      currentModel,
      async (modelValue) => {
        try {
          await this.callbacks.onModelChange(modelValue);
          this.updateDisplay();
        } catch (error) {
          new Notice('Modell konnte nicht gewechselt werden.');
          throw error;
        }
      },
    ).open();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getModelValue?.() ?? this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];

    this.buttonEl.empty();
    this.buttonEl.removeAttribute('title');

    // Toggle auto-style class
    this.buttonEl.toggleClass('is-auto', currentModel === AUTO_MODEL_VALUE);
    if (displayModel?.providerId) {
      this.buttonEl.dataset.provider = displayModel.providerId;
    } else {
      delete this.buttonEl.dataset.provider;
    }

    if (currentModel === AUTO_MODEL_VALUE) {
      const iconEl = this.buttonEl.createSpan({ cls: 'claudian-model-auto-icon' });
      iconEl.setText('✦');
    } else if (displayModel?.providerIcon) {
      const iconEl = this.buttonEl.createSpan({ cls: 'claudian-model-provider-mark' });
      iconEl.appendChild(createProviderIconSvg(displayModel.providerIcon, {
        height: 14,
        ownerDocument: iconEl.ownerDocument,
        width: 14,
      }));
    }

    const labelEl = this.buttonEl.createSpan({ cls: 'claudian-model-label' });
    const displayLabel = displayModel?.label || 'Unbekannt';
    labelEl.setText(displayLabel);
    this.buttonEl.setAttribute('aria-label', `Modell wählen. Aktuell: ${displayLabel}`);
    if (displayModel?.group) {
      this.buttonEl.createSpan({ cls: 'claudian-model-provider-name', text: displayModel.group });
    }

    // Auto transparency: reveal which concrete model the router picked for the
    // last prompt ("✦ Auto · GPT-5.1"), with the routing reason as a tooltip.
    // Guarded on a truthy routed model, so a stale reason never shows.
    if (currentModel === AUTO_MODEL_VALUE) {
      const routeInfo = this.callbacks.getAutoRouteInfo?.();
      if (routeInfo?.model) {
        const routedLabel = models.find(m => m.value === routeInfo.model)?.label ?? routeInfo.model;
        this.buttonEl.createSpan({
          cls: 'claudian-model-auto-route',
          text: `· ${routedLabel}`,
        });
        if (routeInfo.reason) {
          this.buttonEl.setAttribute('title', `Auto-Router: ${routeInfo.reason}`);
        }
      }
    }

    const chevronEl = this.buttonEl.createSpan({ cls: 'claudian-model-chevron' });
    setIcon(chevronEl, 'chevron-down');
  }

  /** Human label of the currently selected model, or null when unknown. */
  getCurrentModelLabel(): string | null {
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const displayModel = models.find(m => m.value === currentModel) || models[0];
    return displayModel?.label ?? null;
  }

  /** Kept for API compatibility; the modal rebuilds its options on every open. */
  renderOptions(): void {
    // no-op
  }

  close(): void {
    // no-op: the modal manages its own lifecycle.
  }

  destroy(): void {
    this.close();
  }
}

/**
 * Sort model options deterministically for the modal:
 * 1. Current provider's models first.
 * 2. Remaining providers in their registered priority order (blankTabOrder).
 * 3. Within a provider: default models first, then alphabetically by label.
 *
 * The aggregated model list is already grouped/sorted by provider, so this
 * keeps that order stable and only hoists the active provider to the top.
 */
function sortModelOptions(models: ProviderUIOption[], currentModelValue: string): ProviderUIOption[] {
  const currentProviderId = models.find((model) => model.value === currentModelValue)?.providerId;
  return [...models].sort((a, b) => {
    const aIsCurrent = a.providerId === currentProviderId;
    const bIsCurrent = b.providerId === currentProviderId;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return 0;
  });
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLButtonElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-mode-selector' });
    this.render();
  }

  private getSelectorConfig(): ProviderModeSelectorConfig | null {
    return this.callbacks.getUIConfig().getModeSelector?.(this.callbacks.getSettings()) ?? null;
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-mode-label' });
    this.toggleEl = this.container.createEl('button', {
      cls: 'claudian-toggle-switch',
      attr: { type: 'button', role: 'switch' },
    });

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Modus konnte nicht gewechselt werden.');
    });

    this.updateDisplay();
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  private resolveOptionPair(
    selectorConfig: ProviderModeSelectorConfig,
  ): { active: ProviderUIOption; inactive: ProviderUIOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }

    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    this.toggleEl.setAttribute('aria-checked', String(isActive));
    this.toggleEl.setAttribute(
      'aria-label',
      `Modus: ${currentOption.label}. Wechseln zu ${isActive ? inactive.label : active.label}`,
    );

    const titleParts = [`${inactive.label} ↔ ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private budgetEl: HTMLElement | null = null;
  private budgetGearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-thinking-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    // Effort selector (for adaptive thinking models)
    this.effortEl = this.container.createDiv({ cls: 'claudian-thinking-effort' });
    const effortLabel = this.effortEl.createSpan({ cls: 'claudian-thinking-label-text' });
    effortLabel.setText('Aufwand:');
    this.effortGearsEl = this.effortEl.createDiv({ cls: 'claudian-thinking-gears' });

    // Legacy budget selector (for custom models)
    this.budgetEl = this.container.createDiv({ cls: 'claudian-thinking-budget' });
    const budgetLabel = this.budgetEl.createSpan({ cls: 'claudian-thinking-label-text' });
    budgetLabel.setText('Denken:');
    this.budgetGearsEl = this.budgetEl.createDiv({ cls: 'claudian-thinking-gears' });

    this.updateDisplay();
  }

  private renderEffortGears() {
    if (!this.effortGearsEl) return;
    this.effortGearsEl.empty();

    const currentEffort = this.callbacks.getSettings().effortLevel;
    const uiConfig = this.callbacks.getUIConfig();
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options = uiConfig.getReasoningOptions(model, settings);
    const currentInfo = options.find(e => e.value === currentEffort);
    const isUltracode = currentEffort === 'ultracode';

    // The collapsed pill reflects the active effort; ultracode gets a distinct
    // gradient + workflow icon so its multi-agent mode reads at a glance.
    this.effortGearsEl.toggleClass('is-ultracode', isUltracode);
    const currentEl = this.effortGearsEl.createEl('button', {
      cls: 'claudian-thinking-current',
      attr: { type: 'button', 'aria-haspopup': 'menu' },
    });
    const currentLabel = currentInfo?.label || options[0]?.label || 'Hoch';
    currentEl.setAttribute('aria-label', `Denkaufwand: ${currentLabel}`);
    if (isUltracode) {
      // Ultracode pill: workflow icon + label + a "Workflows" badge.
      const iconEl = currentEl.createSpan({ cls: 'claudian-thinking-current-icon' });
      setIcon(iconEl, 'workflow');
      currentEl.createSpan({ cls: 'claudian-thinking-current-text', text: currentLabel });
      currentEl.createSpan({ cls: 'claudian-thinking-current-badge', text: 'Abläufe' });
    } else {
      currentEl.setText(currentLabel);
    }

    const optionsEl = this.effortGearsEl.createDiv({ cls: 'claudian-thinking-options' });
    optionsEl.setAttribute('role', 'menu');
    optionsEl.setAttribute('aria-label', 'Denkaufwand wählen');

    for (const effort of [...options].reverse()) {
      const optIsUltracode = effort.value === 'ultracode';
      const gearEl = optionsEl.createEl('button', {
        cls: 'claudian-thinking-gear',
        attr: { type: 'button', role: 'menuitemradio' },
      });
      gearEl.toggleClass('is-ultracode', optIsUltracode);

      const headEl = gearEl.createDiv({ cls: 'claudian-thinking-gear-head' });
      if (optIsUltracode) {
        const gearIconEl = headEl.createSpan({ cls: 'claudian-thinking-gear-icon' });
        setIcon(gearIconEl, 'workflow');
      }
      headEl.createSpan({ cls: 'claudian-thinking-gear-label', text: effort.label });

      if (effort.description) {
        gearEl.createDiv({ cls: 'claudian-thinking-gear-desc', text: effort.description });
      }

      if (effort.value === currentEffort) {
        gearEl.addClass('selected');
      }
      gearEl.setAttribute('aria-checked', String(effort.value === currentEffort));

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onEffortLevelChange(effort.value);
          this.updateDisplay();
        }, 'Denkaufwand konnte nicht geändert werden.');
      });
    }
  }

  private renderBudgetGears() {
    if (!this.budgetGearsEl) return;
    this.budgetGearsEl.empty();

    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const uiConfig = this.callbacks.getUIConfig();
    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const options: ProviderReasoningOption[] = uiConfig.getReasoningOptions(model, settings);
    const currentBudgetInfo = options.find(b => b.value === currentBudget);

    const currentLabel = currentBudgetInfo?.label || options[0]?.label || 'Aus';
    this.budgetGearsEl.createEl('button', {
      cls: 'claudian-thinking-current',
      text: currentLabel,
      attr: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-label': `Denkbudget: ${currentLabel}`,
      },
    });

    const optionsEl = this.budgetGearsEl.createDiv({ cls: 'claudian-thinking-options' });
    optionsEl.setAttribute('role', 'menu');
    optionsEl.setAttribute('aria-label', 'Denkbudget wählen');

    for (const budget of [...options].reverse()) {
      const gearEl = optionsEl.createEl('button', {
        cls: 'claudian-thinking-gear',
        text: budget.label,
        attr: { type: 'button', role: 'menuitemradio' },
      });
      const tokens = budget.tokens ?? 0;
      gearEl.setAttribute('title', tokens > 0 ? `${tokens.toLocaleString('de-DE')} Token` : 'Deaktiviert');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }
      gearEl.setAttribute('aria-checked', String(budget.value === currentBudget));

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onThinkingBudgetChange(budget.value);
          this.updateDisplay();
        }, 'Denkbudget konnte nicht geändert werden.');
      });
    }
  }

  updateDisplay() {
    const capabilities = this.callbacks.getCapabilities();
    if (capabilities.reasoningControl === 'none') {
      this.effortEl?.addClass('claudian-hidden');
      this.budgetEl?.addClass('claudian-hidden');
      return;
    }

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const uiConfig = this.callbacks.getUIConfig();
    const options = uiConfig.getReasoningOptions(model, settings);
    const defaultValue = uiConfig.getDefaultReasoningValue(model, settings);
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);

    if (shouldHide) {
      this.effortEl?.addClass('claudian-hidden');
      this.budgetEl?.addClass('claudian-hidden');
      return;
    }

    const adaptive = uiConfig.isAdaptiveReasoningModel(model, settings);

    if (this.effortEl) {
      this.effortEl.toggleClass('claudian-hidden', !adaptive);
    }
    if (this.budgetEl) {
      this.budgetEl.toggleClass('claudian-hidden', adaptive);
    }

    if (adaptive) {
      this.renderEffortGears();
    } else {
      this.renderBudgetGears();
    }
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLButtonElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-permission-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-permission-label' });
    this.toggleEl = this.container.createEl('button', {
      cls: 'claudian-toggle-switch',
      attr: { type: 'button', role: 'switch' },
    });

    this.updateDisplay();

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Berechtigungsmodus konnte nicht geändert werden.');
    });
  }

  private getToggleConfig(): ProviderPermissionModeToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getPermissionModeToggle?.() ?? null;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    const toggleConfig = this.getToggleConfig();
    const capabilities = this.callbacks.getCapabilities();
    if (!this.visible || !toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    const planValue = toggleConfig.planValue;
    const planLabel = toggleConfig.planLabel ?? 'PLAN';
    const canShowPlan = Boolean(planValue) && capabilities.supportsPlanMode;

    const autoSupported = Boolean(this.callbacks.onAutoModeChange);
    const autoActive = autoSupported
      && this.callbacks.getAutoMode?.() === true
      && mode === toggleConfig.activeValue;

    if (canShowPlan && planValue && mode === planValue) {
      this.toggleEl.addClass('claudian-hidden');
      this.labelEl.setText(planLabel);
      this.labelEl.addClass('plan-active');
      this.labelEl.removeClass('auto-active');
      this.toggleEl.setAttribute('aria-checked', 'false');
      this.toggleEl.setAttribute('aria-label', `Berechtigungsmodus: ${planLabel}`);
    } else {
      this.toggleEl.removeClass('claudian-hidden');
      this.labelEl.removeClass('plan-active');
      if (autoActive) {
        // Third state: "double YOLO" — YOLO permissions + auto-answered prompts.
        this.toggleEl.addClass('active');
        this.toggleEl.addClass('auto');
        this.labelEl.addClass('auto-active');
        this.labelEl.setText('AUTO');
      } else if (mode === toggleConfig.activeValue) {
        this.toggleEl.addClass('active');
        this.toggleEl.removeClass('auto');
        this.labelEl.removeClass('auto-active');
        this.labelEl.setText(toggleConfig.activeLabel);
      } else {
        this.toggleEl.removeClass('active');
        this.toggleEl.removeClass('auto');
        this.labelEl.removeClass('auto-active');
        this.labelEl.setText(toggleConfig.inactiveLabel);
      }
      const isEnabled = mode === toggleConfig.activeValue;
      this.toggleEl.setAttribute('aria-checked', String(isEnabled));
      this.toggleEl.setAttribute('aria-label', `Berechtigungsmodus: ${this.labelEl.textContent ?? ''}`);
    }
  }

  private async toggle() {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().permissionMode;
    const autoSupported = Boolean(this.callbacks.onAutoModeChange);
    const autoOn = autoSupported && this.callbacks.getAutoMode?.() === true;
    const isActive = current === toggleConfig.activeValue;

    // Without auto support, keep the classic 2-state Safe ⇄ YOLO toggle.
    if (!autoSupported) {
      await this.callbacks.onPermissionModeChange(
        isActive ? toggleConfig.inactiveValue : toggleConfig.activeValue,
      );
      this.updateDisplay();
      return;
    }

    // 3-state cycle: Safe → YOLO → AUTO → Safe.
    if (!isActive) {
      // Safe → YOLO
      if (autoOn) await this.callbacks.onAutoModeChange?.(false);
      await this.callbacks.onPermissionModeChange(toggleConfig.activeValue);
    } else if (!autoOn) {
      // YOLO → AUTO
      await this.callbacks.onAutoModeChange?.(true);
    } else {
      // AUTO → Safe
      await this.callbacks.onAutoModeChange?.(false);
      await this.callbacks.onPermissionModeChange(toggleConfig.inactiveValue);
    }
    this.updateDisplay();
  }
}

export class ServiceTierToggle {
  private container: HTMLElement;
  private buttonEl: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private runtimeState: 'off' | 'on' | 'cooldown' = 'off';

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-service-tier-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createEl('button', {
      cls: 'claudian-service-tier-button clickable-icon',
      attr: { type: 'button', 'aria-label': 'Schnellmodus' },
    });
    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-service-tier-icon' });
    setIcon(this.iconEl, 'zap');
    this.labelEl = this.buttonEl.createSpan({ cls: 'claudian-service-tier-label' });

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(
        () => this.toggle().then(() => undefined),
        'Schnellmodus konnte nicht umgeschaltet werden.',
      );
    });
  }

  private getToggleConfig(): ProviderServiceTierToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getServiceTierToggle?.(this.callbacks.getSettings()) ?? null;
  }

  isAvailable(): boolean {
    return this.getToggleConfig() !== null;
  }

  setRuntimeState(state: 'off' | 'on' | 'cooldown'): void {
    this.runtimeState = state;
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl) return;

    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) {
      this.container.addClass('claudian-hidden');
      this.buttonEl.removeAttribute('aria-pressed');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const current = this.callbacks.getSettings().serviceTier;
    const isActive = current === toggleConfig.activeValue;
    this.buttonEl.toggleClass('active', isActive);
    this.buttonEl.toggleClass('is-cooldown', this.runtimeState === 'cooldown');
    this.buttonEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    this.buttonEl.setAttribute('aria-label', `Schnellmodus: ${isActive ? 'ein' : 'aus'}`);
    this.labelEl?.setText(toggleConfig.activeLabel);

    if (this.runtimeState === 'cooldown') {
      this.container.setAttribute('title', 'Schnelllimit erreicht. Rückfall auf Standardtempo.');
    } else if (isActive) {
      this.container.setAttribute(
        'title',
        toggleConfig.description ?? 'Schnellmodus aktiv. Zum Ausschalten klicken.',
      );
    } else {
      this.container.setAttribute(
        'title',
        toggleConfig.description ?? 'Schnellmodus: höheres Tempo und höhere Kosten.',
      );
    }
  }

  async toggle(): Promise<boolean> {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return false;

    const current = this.callbacks.getSettings().serviceTier;
    const next = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onServiceTierChange(next);
    if (next !== toggleConfig.activeValue) {
      this.runtimeState = 'off';
    } else if (this.runtimeState === 'off') {
      this.runtimeState = 'on';
    }
    this.updateDisplay();
    return next === toggleConfig.activeValue;
  }
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export class ExternalContextSelector {
  private container: HTMLElement;
  private triggerEl: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(`${invalidPaths.length} ungültige externe Kontextpfade entfernt: ${pathNames}`, 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidDirectoryPath(path)) {
        new Notice(`„${this.shortenPath(path)}“ kann nicht dauerhaft gespeichert werden: Ordner nicht gefunden.`, 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically (e.g., from /add-dir command).
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'Kein Pfad angegeben. Verwendung: /add-dir /absoluter/pfad' };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: 'Der Pfad muss absolut sein. Verwendung: /add-dir /absoluter/pfad' };
    }

    // Validate path exists and is a directory with specific error messages
    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${describeDirectoryValidationError(validation.error)}: ${pathInput}` };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: 'Dieser Ordner ist bereits als externer Kontext hinterlegt.' };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    this.triggerEl = this.container.createEl('button', {
      cls: 'claudian-external-context-icon-wrapper clickable-icon',
      attr: { type: 'button', 'aria-label': 'Externen Kontext hinzufügen' },
    });

    this.iconEl = this.triggerEl.createDiv({ cls: 'claudian-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = this.triggerEl.createDiv({ cls: 'claudian-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    this.triggerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'claudian-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Externen Kontext wählen',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice('Dieser Ordner ist bereits als externer Kontext hinterlegt.', 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice('Ordnerauswahl konnte nicht geöffnet werden.', 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? `„${shortNew}“ liegt im bereits hinzugefügten Pfad „${shortExisting}“.`
      : `„${shortNew}“ enthält den bereits hinzugefügten Pfad „${shortExisting}“.`;
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'claudian-external-context-header' });
    headerEl.setText('Externe Kontexte');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'claudian-external-context-list' });
    listEl.setAttribute('role', 'list');

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'claudian-external-context-empty' });
      emptyEl.setText('Zum Hinzufügen auf das Ordner-Symbol klicken');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'claudian-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'claudian-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createEl('button', {
          cls: 'claudian-external-context-lock',
          attr: { type: 'button', 'aria-pressed': String(isPersistent) },
        });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        const persistenceLabel = isPersistent
          ? 'Dauerhaft gespeichert. Nur für diese Sitzung verwenden'
          : 'Nur für diese Sitzung. Dauerhaft speichern';
        lockBtn.setAttribute('title', persistenceLabel);
        lockBtn.setAttribute('aria-label', persistenceLabel);
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createEl('button', {
          cls: 'claudian-external-context-remove',
          attr: { type: 'button', 'aria-label': `${displayPath} entfernen` },
        });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Pfad entfernen');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl || !this.triggerEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      const label = `${count} externe${count === 1 ? 'r Kontext' : ' Kontexte'}. Weiteren Ordner hinzufügen`;
      this.triggerEl.setAttribute('title', label);
      this.triggerEl.setAttribute('aria-label', label);

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.triggerEl.setAttribute('title', 'Externen Kontext hinzufügen');
      this.triggerEl.setAttribute('aria-label', 'Externen Kontext hinzufügen');
      this.badgeEl.removeClass('visible');
    }
  }
}

export class McpServerSelector {
  private container: HTMLElement;
  private triggerEl: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;
  private dropdownOpen = false;

  private readonly handleDocumentPointerDown = (event: Event): void => {
    if (!this.dropdownOpen || this.container.contains(event.target as Node)) return;
    this.closeDropdown(false);
  };

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-mcp-selector' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.closeDropdown(false);
      this.container.addClass('claudian-hidden');
    } else {
      this.updateDisplay();
    }
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  closeMenu(): void {
    this.closeDropdown(false);
  }

  destroy(): void {
    this.closeDropdown(false);
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    this.triggerEl = this.container.createEl('button', {
      cls: 'claudian-mcp-selector-icon-wrapper',
      attr: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-label': 'MCP-Server verwalten',
      },
    });

    this.iconEl = this.triggerEl.createDiv({ cls: 'claudian-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = this.triggerEl.createDiv({ cls: 'claudian-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'claudian-mcp-selector-dropdown' });
    this.dropdownEl.setAttribute('role', 'menu');
    this.dropdownEl.setAttribute('aria-label', 'MCP-Server');
    this.dropdownEl.addEventListener('keydown', (event) => this.handleMenuKeydown(event));
    this.renderDropdown();

    this.triggerEl.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.dropdownOpen) {
        this.closeDropdown();
      } else {
        this.openDropdown();
      }
    });

    this.container.addEventListener('focusout', (event: FocusEvent) => {
      if (!this.dropdownOpen || this.container.contains(event.relatedTarget as Node)) return;
      const ownerWindow = this.container.ownerDocument.defaultView ?? window;
      ownerWindow.setTimeout(() => {
        const active = this.container.ownerDocument.activeElement;
        if (this.dropdownOpen && !this.container.contains(active)) this.closeDropdown(false);
      }, 0);
    });

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'claudian-mcp-selector-header' });
    headerEl.setText('MCP-Server');

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'claudian-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'claudian-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'Keine MCP-Server konfiguriert' : 'Alle MCP-Server sind deaktiviert');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private openDropdown(): void {
    if (!this.dropdownEl || !this.triggerEl) return;
    this.dropdownOpen = true;
    this.dropdownEl.addClass('visible');
    this.triggerEl.setAttribute('aria-expanded', 'true');
    this.container.ownerDocument.addEventListener?.('pointerdown', this.handleDocumentPointerDown);
    this.getMenuItems()[0]?.focus();
  }

  private closeDropdown(restoreFocus = true): void {
    this.dropdownOpen = false;
    this.dropdownEl?.removeClass('visible');
    this.triggerEl?.setAttribute('aria-expanded', 'false');
    this.container.ownerDocument.removeEventListener?.('pointerdown', this.handleDocumentPointerDown);
    if (restoreFocus) this.triggerEl?.focus();
  }

  private getMenuItems(): HTMLButtonElement[] {
    return Array.from(
      this.dropdownEl?.querySelectorAll<HTMLButtonElement>('.claudian-mcp-selector-item') ?? [],
    );
  }

  private handleMenuKeydown(event: KeyboardEvent): void {
    if (!this.dropdownOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeDropdown();
      return;
    }

    const items = this.getMenuItems();
    if (items.length === 0) return;
    const targetIndex = items.findIndex((item) =>
      item === event.target || item.contains(event.target as Node));
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      nextIndex = targetIndex < 0 ? 0 : (targetIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = targetIndex < 0 ? items.length - 1 : (targetIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createEl('button', {
      cls: 'claudian-mcp-selector-item',
      attr: {
        type: 'button',
        role: 'menuitemcheckbox',
        'aria-checked': String(this.enabledServers.has(server.name)),
      },
    });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'claudian-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'claudian-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'claudian-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'claudian-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', `Kontextsparend: auch über @${server.name} aktivierbar`);
    }

    itemEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    itemEl.setAttribute('aria-checked', String(isEnabled));
    const checkEl = itemEl.querySelector<HTMLElement>('.claudian-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl || !this.triggerEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpManager?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.closeDropdown(false);
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');

    if (count > 0) {
      this.iconEl.addClass('active');
      const label = `${count} MCP-Server aktiviert. Server verwalten`;
      this.triggerEl.setAttribute('title', label);
      this.triggerEl.setAttribute('aria-label', label);

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.triggerEl.setAttribute('title', 'MCP-Server verwalten');
      this.triggerEl.setAttribute('aria-label', 'MCP-Server verwalten');
      this.badgeEl.removeClass('visible');
    }
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-context-meter' });
    this.render();
    // Initially hidden
    this.container.addClass('claudian-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('claudian-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'claudian-context-meter-gauge' });
    const svg = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    backgroundPath.classList.add('claudian-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    fillPath.classList.add('claudian-meter-fill');
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);
    this.fillPath = fillPath;

    this.percentEl = this.container.createSpan({ cls: 'claudian-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    // Providers that report no token counts (Kimi, Antigravity) send an
    // estimated usage; signal that with a leading "≈" and a tooltip note so the
    // meter isn't mistaken for an exact provider-reported figure.
    const approximate = usage.contextWindowIsAuthoritative === false;
    this.container.toggleClass('estimated', approximate);

    if (this.percentEl) {
      this.percentEl.setText(`${approximate ? '≈' : ''}${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${approximate ? 'Geschätzt · ' : ''}${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Limit fast erreicht – mit `/compact` fortfahren)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (!Number.isFinite(tokens) || tokens < 0) {
      return '0';
    }
    if (tokens >= 1_000_000_000) {
      return `${(tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
    }
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return String(Math.round(tokens));
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
  serviceTierToggle: ServiceTierToggle;
} {
  const controlGroup = parentEl.createDiv({ cls: 'claudian-toolbar-control-group' });
  const primaryGroup = controlGroup.createDiv({ cls: 'claudian-toolbar-primary-group' });
  const contextGroup = controlGroup.createDiv({ cls: 'claudian-toolbar-context-group' });
  const modeGroup = parentEl.createDiv({ cls: 'claudian-toolbar-mode-group' });

  const modelSelector = new ModelSelector(primaryGroup, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(primaryGroup, callbacks);
  const serviceTierToggle = new ServiceTierToggle(primaryGroup, callbacks);
  const contextUsageMeter = new ContextUsageMeter(contextGroup);
  const externalContextSelector = new ExternalContextSelector(contextGroup, callbacks);
  const mcpServerSelector = new McpServerSelector(contextGroup);
  const permissionToggle = new PermissionToggle(modeGroup, callbacks);
  const modeSelector = new ModeSelector(modeGroup, callbacks);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    serviceTierToggle,
    contextUsageMeter,
    externalContextSelector,
    mcpServerSelector,
    permissionToggle,
  };
}

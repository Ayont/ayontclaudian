import { setIcon, setTooltip } from 'obsidian';

import {
  getWorkspaceModeClass,
  getWorkspaceModeMeta,
  WORKSPACE_MODE_CLASSES,
  type WorkspaceMode,
} from '../../../core/workspace/workspaceMode';

export interface WorkspaceModeToggleOptions {
  /** Current mode (read fresh on every render/interaction). */
  getMode: () => WorkspaceMode;
  /** Persists the new mode; the toggle re-renders after it resolves. */
  onModeChange: (mode: WorkspaceMode) => Promise<void>;
}

const MODES: readonly WorkspaceMode[] = ['code', 'work'];

/**
 * Segmented Code/Work switch shown in the chat header actions.
 *
 * Two icon+label segments with a sliding thumb (transform-only animation).
 * The active mode also drives a container-level class (accent shift) and the
 * chat input placeholder — both applied by `applyWorkspaceModeToContainer`.
 */
export class WorkspaceModeToggle {
  private readonly rootEl: HTMLElement;
  private readonly thumbEl: HTMLElement;
  private readonly segmentEls = new Map<WorkspaceMode, HTMLElement>();

  constructor(parent: HTMLElement, private readonly options: WorkspaceModeToggleOptions) {
    this.rootEl = parent.createDiv({ cls: 'claudian-mode-toggle' });
    this.rootEl.setAttribute('role', 'group');
    this.rootEl.setAttribute('aria-label', 'Workspace-Modus');

    // Sliding thumb sits behind the segment buttons; moved via transform.
    this.thumbEl = this.rootEl.createDiv({ cls: 'claudian-mode-toggle-thumb' });
    this.thumbEl.setAttribute('aria-hidden', 'true');

    for (const mode of MODES) {
      const meta = getWorkspaceModeMeta(mode);
      const segment = this.rootEl.createEl('button', {
        cls: 'claudian-mode-toggle-segment',
        attr: { 'data-mode': mode, type: 'button' },
      });
      setTooltip(segment, meta.tooltip, { placement: 'bottom' });
      const iconEl = segment.createSpan({ cls: 'claudian-mode-toggle-icon' });
      setIcon(iconEl, meta.icon);
      segment.createSpan({ cls: 'claudian-mode-toggle-label', text: meta.label });
      segment.addEventListener('click', () => {
        void this.select(mode);
      });
      this.segmentEls.set(mode, segment);
    }

    this.render();
  }

  /** Re-syncs the toggle to the current mode (thumb position + aria). */
  render(): void {
    const active = this.options.getMode();
    const index = MODES.indexOf(active);
    // Each segment is 50% wide → the thumb slides by its own width per step.
    this.thumbEl.style.transform = `translateX(${index * 100}%)`;
    for (const [mode, segment] of this.segmentEls) {
      const isActive = mode === active;
      segment.classList.toggle('is-active', isActive);
      segment.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  private async select(mode: WorkspaceMode): Promise<void> {
    if (mode === this.options.getMode()) {
      return;
    }
    await this.options.onModeChange(mode);
    this.render();
  }
}

/** Duration guard for removing the one-shot mode-switch crossfade class. */
const MODE_SWITCH_ANIMATION_MS = 400;

/**
 * Applies the active mode to the chat container: swaps the
 * `claudian-mode-*` class (accent + themed surfaces via CSS) and updates
 * every chat input placeholder in the container. With `animate`, plays the
 * one-shot crossfade (`claudian-mode-switching`) so the re-accenting reads
 * as a deliberate scene change.
 */
export function applyWorkspaceModeToContainer(
  container: HTMLElement,
  mode: WorkspaceMode,
  options?: { animate?: boolean },
): void {
  for (const cls of WORKSPACE_MODE_CLASSES) {
    container.classList.remove(cls);
  }
  container.classList.add(getWorkspaceModeClass(mode));

  const placeholder = getWorkspaceModeMeta(mode).placeholder;
  const inputs = container.querySelectorAll<HTMLTextAreaElement>('textarea.claudian-input');
  inputs.forEach((input) => {
    input.placeholder = placeholder;
  });

  if (options?.animate) {
    container.classList.remove('claudian-mode-switching');
    // Force a reflow so re-adding the class restarts the animation even when
    // the user toggles rapidly.
    void container.offsetWidth;
    container.classList.add('claudian-mode-switching');
    window.setTimeout(() => {
      container.classList.remove('claudian-mode-switching');
    }, MODE_SWITCH_ANIMATION_MS);
  }
}

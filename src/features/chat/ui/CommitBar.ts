import { setIcon } from 'obsidian';

import type { GitFileChange, GitService } from '../../../core/git/GitService';

/** Cap on file names listed in an auto-suggested commit message. */
const SUGGEST_FILE_LIMIT = 3;

/** Reset delay (ms) for the transient success/error feedback row. */
const FEEDBACK_RESET_MS = 4000;

/** Returns just the basename of a repo-relative path (forward-slash safe). */
function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Builds a default commit message from a set of changed files. Pure and
 * exported so it can be unit-tested in isolation.
 *
 * - No changes -> empty string (caller should keep Commit disabled).
 * - Lists up to {@link SUGGEST_FILE_LIMIT} basenames, then `(+N more)`.
 *
 * @example suggestCommitMessage([{path:'a.ts'},{path:'b.ts'}]) -> "update: a.ts, b.ts"
 */
export function suggestCommitMessage(files: ReadonlyArray<GitFileChange>): string {
  if (files.length === 0) {
    return '';
  }
  const names = files.map((file) => basename(file.path));
  const shown = names.slice(0, SUGGEST_FILE_LIMIT);
  const remaining = names.length - shown.length;
  const suffix = remaining > 0 ? ` (+${remaining} more)` : '';
  return `update: ${shown.join(', ')}${suffix}`;
}

/** Human-readable summary of the change count, e.g. "1 changed file". */
export function describeChangeCount(count: number): string {
  if (count === 0) {
    return 'No changes';
  }
  return count === 1 ? '1 changed file' : `${count} changed files`;
}

type FeedbackKind = 'success' | 'error';

/**
 * Compact git commit bar mounted in the chat input area. Shows the current
 * branch and changed-file count, accepts a commit message (with an auto-suggest
 * affordance), and runs `commitAll` with an optional push. Every git call is
 * async and failures surface inline — the component never throws to the UI.
 */
export class CommitBar {
  private readonly container: HTMLElement;
  private readonly git: GitService;

  private headerEl: HTMLElement | null = null;
  private branchEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private suggestBtn: HTMLElement | null = null;
  private commitBtn: HTMLElement | null = null;
  private pushBtn: HTMLElement | null = null;
  private feedbackEl: HTMLElement | null = null;

  private files: GitFileChange[] = [];
  private branch: string | null = null;
  private running = false;
  private destroyed = false;
  private feedbackTimer: number | null = null;

  private readonly boundInput = () => this.updateControls();

  constructor(parentEl: HTMLElement, git: GitService) {
    this.git = git;
    this.container = parentEl.createDiv({ cls: 'claudian-commit-bar claudian-hidden' });
    this.render();
    void this.refresh();
  }

  /** Builds the static DOM. Visibility is decided later by {@link refresh}. */
  private render(): void {
    this.container.empty();

    this.headerEl = this.container.createDiv({ cls: 'claudian-commit-bar-header' });
    const branchWrap = this.headerEl.createDiv({ cls: 'claudian-commit-bar-branch' });
    const branchIcon = branchWrap.createSpan({ cls: 'claudian-commit-bar-branch-icon' });
    setIcon(branchIcon, 'git-branch');
    this.branchEl = branchWrap.createSpan({ cls: 'claudian-commit-bar-branch-name' });
    this.countEl = this.headerEl.createSpan({ cls: 'claudian-commit-bar-count' });

    const row = this.container.createDiv({ cls: 'claudian-commit-bar-row' });

    const input = row.createEl('input', {
      cls: 'claudian-commit-bar-input',
      attr: { type: 'text', placeholder: 'Commit-Nachricht…', dir: 'auto' },
    });
    this.inputEl = input as HTMLInputElement;
    this.inputEl.addEventListener('input', this.boundInput);

    this.suggestBtn = row.createDiv({ cls: 'claudian-commit-bar-suggest' });
    this.suggestBtn.setAttribute('role', 'button');
    this.suggestBtn.setAttribute('tabindex', '0');
    this.suggestBtn.setAttribute('title', 'Nachricht aus Änderungen vorschlagen');
    const suggestIcon = this.suggestBtn.createSpan({ cls: 'claudian-commit-bar-suggest-icon' });
    setIcon(suggestIcon, 'sparkles');
    this.suggestBtn.addEventListener('click', () => this.applySuggestion());
    this.suggestBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.applySuggestion();
      }
    });

    const actions = this.container.createDiv({ cls: 'claudian-commit-bar-actions' });

    this.commitBtn = actions.createDiv({ cls: 'claudian-commit-bar-btn claudian-commit-bar-commit' });
    this.commitBtn.setAttribute('role', 'button');
    this.commitBtn.setAttribute('tabindex', '0');
    this.commitBtn.setText('Commit');
    this.commitBtn.addEventListener('click', () => this.runCommit(false));
    this.commitBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.runCommit(false);
      }
    });

    this.pushBtn = actions.createDiv({ cls: 'claudian-commit-bar-btn claudian-commit-bar-push' });
    this.pushBtn.setAttribute('role', 'button');
    this.pushBtn.setAttribute('tabindex', '0');
    this.pushBtn.setText('Commit & Push');
    this.pushBtn.addEventListener('click', () => this.runCommit(true));
    this.pushBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.runCommit(true);
      }
    });

    this.feedbackEl = this.container.createDiv({ cls: 'claudian-commit-bar-feedback claudian-hidden' });
  }

  /**
   * Re-checks the repo and refreshes branch + file count. Safe to call any
   * time; if the workspace is not a git repo the bar stays hidden.
   */
  async refresh(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    let isRepo = false;
    try {
      isRepo = await this.git.isRepo();
    } catch {
      isRepo = false;
    }
    if (this.destroyed) {
      return;
    }
    if (!isRepo) {
      this.container.addClass('claudian-hidden');
      return;
    }

    try {
      const status = await this.git.status();
      this.branch = status.branch;
      this.files = status.files;
    } catch {
      this.branch = null;
      this.files = [];
    }
    if (this.destroyed) {
      return;
    }
    this.container.removeClass('claudian-hidden');
    this.updateDisplay();
  }

  /** Syncs the branch label + change count from current state. */
  private updateDisplay(): void {
    if (this.branchEl) {
      this.branchEl.setText(this.branch ?? 'detached');
    }
    if (this.countEl) {
      this.countEl.setText(describeChangeCount(this.files.length));
    }
    this.updateControls();
  }

  /** Enables/disables Commit + Push based on message, changes, and run state. */
  private updateControls(): void {
    const hasMessage = (this.inputEl?.value.trim().length ?? 0) > 0;
    const hasChanges = this.files.length > 0;
    const canCommit = hasMessage && hasChanges && !this.running;

    this.toggleDisabled(this.commitBtn, !canCommit);
    this.toggleDisabled(this.pushBtn, !canCommit);
    this.toggleDisabled(this.suggestBtn, !hasChanges || this.running);
  }

  private toggleDisabled(el: HTMLElement | null, disabled: boolean): void {
    if (!el) {
      return;
    }
    el.toggleClass('claudian-commit-bar-disabled', disabled);
    el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  /** Fills the input with a suggested message derived from current changes. */
  private applySuggestion(): void {
    if (this.running || this.files.length === 0 || !this.inputEl) {
      return;
    }
    this.inputEl.value = suggestCommitMessage(this.files);
    this.updateControls();
  }

  /**
   * Re-validates state at click time, then commits (and optionally pushes).
   * Surfaces git stderr inline on failure; never throws.
   */
  private async runCommit(withPush: boolean): Promise<void> {
    if (this.running) {
      return;
    }
    const message = this.inputEl?.value.trim() ?? '';
    if (!message) {
      this.showFeedback('error', 'Commit-Nachricht fehlt');
      return;
    }

    this.setRunning(true);
    try {
      // Re-check status at execution time, not just at mount/refresh.
      let liveFiles: GitFileChange[] = this.files;
      try {
        const status = await this.git.status();
        liveFiles = status.files;
      } catch {
        // Fall back to last-known state; commitAll still validates server-side.
      }
      if (liveFiles.length === 0) {
        this.files = liveFiles;
        this.setRunning(false);
        this.updateDisplay();
        this.showFeedback('error', 'Keine Änderungen zum Committen');
        return;
      }

      const commit = await this.git.commitAll(message);
      if (!commit.ok) {
        this.setRunning(false);
        this.showFeedback('error', commit.error ?? 'Commit fehlgeschlagen');
        return;
      }

      if (withPush) {
        const push = await this.git.push();
        if (!push.ok) {
          this.setRunning(false);
          if (this.inputEl) {
            this.inputEl.value = '';
          }
          await this.refresh();
          this.showFeedback('error', push.error ?? 'Push fehlgeschlagen');
          return;
        }
      }

      this.setRunning(false);
      if (this.inputEl) {
        this.inputEl.value = '';
      }
      await this.refresh();
      this.showFeedback('success', withPush ? 'Committed & gepusht' : 'Committed');
    } catch (error) {
      this.setRunning(false);
      const detail = error instanceof Error ? error.message : 'Unbekannter Fehler';
      this.showFeedback('error', detail);
    }
  }

  /** Toggles the running state and reflects it as a spinner on Commit. */
  private setRunning(running: boolean): void {
    this.running = running;
    if (this.commitBtn) {
      this.commitBtn.empty();
      if (running) {
        const spinner = this.commitBtn.createSpan({ cls: 'claudian-commit-bar-spinner spin' });
        setIcon(spinner, 'loader-2');
      } else {
        this.commitBtn.setText('Commit');
      }
    }
    this.updateControls();
  }

  /** Shows a transient success/error message that auto-clears. */
  private showFeedback(kind: FeedbackKind, text: string): void {
    if (!this.feedbackEl) {
      return;
    }
    if (this.feedbackTimer !== null) {
      window.clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.feedbackEl.empty();
    this.feedbackEl.removeClass('claudian-hidden');
    this.feedbackEl.toggleClass('claudian-commit-bar-feedback-error', kind === 'error');
    this.feedbackEl.toggleClass('claudian-commit-bar-feedback-success', kind === 'success');

    const icon = this.feedbackEl.createSpan({ cls: 'claudian-commit-bar-feedback-icon' });
    setIcon(icon, kind === 'success' ? 'check' : 'x');
    this.feedbackEl.createSpan({ cls: 'claudian-commit-bar-feedback-text', text });

    this.feedbackTimer = window.setTimeout(() => {
      this.feedbackEl?.addClass('claudian-hidden');
      this.feedbackTimer = null;
    }, FEEDBACK_RESET_MS);
  }

  /** Removes listeners and timers; safe to call multiple times. */
  destroy(): void {
    this.destroyed = true;
    if (this.feedbackTimer !== null) {
      window.clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.inputEl?.removeEventListener('input', this.boundInput);
  }
}

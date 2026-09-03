import type { App } from 'obsidian';
import { Menu, Modal, Notice, setIcon } from 'obsidian';

import type { AheadBehind, GitFileChange, GitService } from '../../../core/git/GitService';
import { toGitHubHttpsUrl } from '../../../core/git/GitService';
import { getLocale } from '../../../i18n/i18n';

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
export function describeChangeCount(count: number, locale: string = getLocale()): string {
  if (locale === 'en') {
    if (count === 0) {
      return 'No changes';
    }
    return count === 1 ? '1 changed file' : `${count} changed files`;
  }
  if (count === 0) {
    return 'Keine Änderungen';
  }
  return count === 1 ? '1 geänderte Datei' : `${count} geänderte Dateien`;
}


export class BranchPromptModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly placeholderText: string,
    private readonly submitText: string,
    private readonly onSubmit: (branchName: string) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.empty();
    const isDe = getLocale() === "de";
    const form = this.contentEl.createDiv({ cls: "claudian-branch-prompt-form" });
    const input = form.createEl("input", {
      type: "text",
      cls: "claudian-branch-prompt-input",
      attr: { placeholder: this.placeholderText, spellcheck: "false" },
    });
    const actions = form.createDiv({ cls: "claudian-branch-prompt-actions" });
    const cancelBtn = actions.createEl("button", {
      text: isDe ? "Abbrechen" : "Cancel",
      attr: { type: "button" },
    });
    cancelBtn.addEventListener("click", () => this.close());
    const submitBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: this.submitText,
      attr: { type: "button" },
    });
    const doSubmit = (): void => {
      const val = input.value.trim();
      if (val) {
        void this.onSubmit(val);
        this.close();
      }
    };
    submitBtn.addEventListener("click", doSubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSubmit();
      }
    });
    window.requestAnimationFrame(() => input.focus());
  }

  onClose(): void {
    this.contentEl.empty();
  }
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
  private repoRowEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private suggestBtn: HTMLElement | null = null;
  private commitBtn: HTMLElement | null = null;
  private pushBtn: HTMLElement | null = null;
  private feedbackEl: HTMLElement | null = null;

  private files: GitFileChange[] = [];
  private branch: string | null = null;
  private remoteUrl: string | null = null;
  private aheadBehind: AheadBehind | null = null;
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
    const isDe = getLocale() === 'de';
    const branchWrap = this.headerEl.createDiv({
      cls: 'claudian-commit-bar-branch claudian-commit-bar-branch--clickable',
    });
    branchWrap.setAttribute('role', 'button');
    branchWrap.setAttribute('tabindex', '0');
    branchWrap.setAttribute(
      'aria-label',
      isDe ? 'Git-Branch wechseln oder erstellen' : 'Switch or create Git branch',
    );
    branchWrap.setAttribute(
      'title',
      isDe ? 'Klicken, um Branch zu wechseln' : 'Click to switch branch',
    );

    const branchIcon = branchWrap.createSpan({ cls: 'claudian-commit-bar-branch-icon' });
    setIcon(branchIcon, 'git-branch');
    this.branchEl = branchWrap.createSpan({ cls: 'claudian-commit-bar-branch-name' });
    const branchChevron = branchWrap.createSpan({ cls: 'claudian-commit-bar-branch-chevron' });
    setIcon(branchChevron, 'chevron-down');

    branchWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.showBranchPicker(branchWrap);
    });
    branchWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void this.showBranchPicker(branchWrap);
      }
    });
    this.countEl = this.headerEl.createSpan({ cls: 'claudian-commit-bar-count' });

    // Remote/GitHub row — populated (and shown) by updateRepoRow when a remote exists.
    this.repoRowEl = this.container.createDiv({ cls: 'claudian-commit-bar-repo claudian-hidden' });

    const row = this.container.createDiv({ cls: 'claudian-commit-bar-row' });

    const input = row.createEl('input', {
      cls: 'claudian-commit-bar-input',
      attr: {
        type: 'text',
        placeholder: 'Commit-Nachricht…',
        dir: 'auto',
        'aria-label': 'Commit-Nachricht',
      },
    });
    this.inputEl = input as HTMLInputElement;
    this.inputEl.addEventListener('input', this.boundInput);

    this.suggestBtn = row.createEl('button', {
      cls: 'claudian-commit-bar-suggest',
      attr: {
        type: 'button',
        title: 'Nachricht aus Änderungen vorschlagen',
        'aria-label': 'Commit-Nachricht aus Änderungen vorschlagen',
      },
    });
    const suggestIcon = this.suggestBtn.createSpan({ cls: 'claudian-commit-bar-suggest-icon' });
    setIcon(suggestIcon, 'sparkles');
    this.suggestBtn.addEventListener('click', () => this.applySuggestion());

    const actions = this.container.createDiv({ cls: 'claudian-commit-bar-actions' });

    this.commitBtn = actions.createEl('button', {
      cls: 'claudian-commit-bar-btn claudian-commit-bar-commit',
      text: 'Commit',
      attr: { type: 'button' },
    });
    this.commitBtn.addEventListener('click', () => this.runCommit(false));

    this.pushBtn = actions.createEl('button', {
      cls: 'claudian-commit-bar-btn claudian-commit-bar-push',
      text: 'Commit & Push',
      attr: { type: 'button' },
    });
    this.pushBtn.addEventListener('click', () => this.runCommit(true));

    this.feedbackEl = this.container.createDiv({ cls: 'claudian-commit-bar-feedback claudian-hidden' });
    this.feedbackEl.setAttribute('role', 'status');
    this.feedbackEl.setAttribute('aria-live', 'polite');
    this.feedbackEl.setAttribute('aria-atomic', 'true');
  }

  /**
   * Re-checks the repo and refreshes branch + file count. Safe to call any
   * time; if the workspace is not a git repo the bar stays hidden.
   */
  async refresh(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    let isRepo: boolean;
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

    // Remote + ahead/behind are best-effort: a repo without a remote or upstream
    // still renders the bar, just without the GitHub row. Never throw to the UI.
    const [remoteUrl, aheadBehind] = await Promise.all([
      this.git.getRemoteUrl().catch(() => null),
      this.git.aheadBehind().catch(() => null),
    ]);
    this.remoteUrl = remoteUrl;
    this.aheadBehind = aheadBehind;

    if (this.destroyed) {
      return;
    }
    this.container.removeClass('claudian-hidden');
    this.updateDisplay();
  }

  /** Syncs the branch label + change count from current state. */
  private updateDisplay(): void {
    if (this.branchEl) {
      this.branchEl.setText(this.branch ?? 'ohne Branch');
    }
    if (this.countEl) {
      this.countEl.setText(describeChangeCount(this.files.length));
    }
    this.updateRepoRow();
    this.updateControls();
  }

  /**
   * Renders the remote/GitHub row: a clickable link to the remote (normalized to
   * an https GitHub URL when applicable) plus ahead/behind vs upstream. Hides
   * the whole row when there is no remote. Rebuilds from scratch each refresh so
   * a removed remote disappears cleanly.
   */
  private updateRepoRow(): void {
    const row = this.repoRowEl;
    if (!row) {
      return;
    }
    row.empty();

    if (!this.remoteUrl) {
      row.addClass('claudian-hidden');
      return;
    }

    const githubUrl = toGitHubHttpsUrl(this.remoteUrl);
    const href = githubUrl ?? this.remoteUrl;
    const label = githubUrl ? githubUrl.replace(/^https:\/\//, '') : this.remoteUrl;

    const link = row.createEl('a', { cls: 'claudian-commit-bar-remote' });
    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('title', this.remoteUrl);

    const icon = link.createSpan({ cls: 'claudian-commit-bar-remote-icon' });
    setIcon(icon, githubUrl ? 'github' : 'git-branch');
    link.createSpan({ cls: 'claudian-commit-bar-remote-name', text: label });

    const ab = this.aheadBehind;
    if (ab && (ab.ahead > 0 || ab.behind > 0)) {
      const sync = row.createSpan({ cls: 'claudian-commit-bar-sync' });
      if (ab.ahead > 0) {
        sync.createSpan({ cls: 'claudian-commit-bar-sync-ahead', text: `↑${ab.ahead}` });
      }
      if (ab.behind > 0) {
        sync.createSpan({ cls: 'claudian-commit-bar-sync-behind', text: `↓${ab.behind}` });
      }
    }

    row.removeClass('claudian-hidden');
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
    (el as HTMLButtonElement).disabled = disabled;
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
      this.showFeedback('success', withPush ? 'Commit erstellt und gepusht' : 'Commit erstellt');
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
  private async showBranchPicker(anchorEl: HTMLElement): Promise<void> {
    const isDe = getLocale() === "de";
    let branches: { name: string; current: boolean }[];
    try {
      branches = await this.git.listBranches();
    } catch {
      branches = this.branch ? [{ name: this.branch, current: true }] : [];
    }

    if (branches.length === 0 && this.branch) {
      branches = [{ name: this.branch, current: true }];
    }

    const menu = new Menu();
    for (const b of branches) {
      menu.addItem((item) => {
        item
          .setTitle(b.name)
          .setIcon(b.current ? "check" : "git-branch")
          .setDisabled(b.current)
          .onClick(async () => {
            if (b.current) return;
            const res = await this.git.checkoutBranch(b.name);
            if (res.ok) {
              new Notice(isDe ? `Branch gewechselt zu: ${b.name}` : `Switched to branch: ${b.name}`);
              await this.refresh();
            } else {
              new Notice(isDe ? `Branch-Wechsel fehlgeschlagen: ${res.error}` : `Branch checkout failed: ${res.error}`);
            }
          });
      });
    }

    if (typeof (menu as any).addSeparator === 'function') (menu as any).addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(isDe ? "Neuer Branch…" : "New branch…")
        .setIcon("plus")
        .onClick(() => {
          const app = (window as unknown as { app?: App }).app;
          if (!app) return;
          new BranchPromptModal(
            app,
            isDe ? "Neuen Git-Branch erstellen" : "Create new Git branch",
            isDe ? "Branch-Name (z.B. feature/design)" : "Branch name (e.g. feature/design)",
            isDe ? "Erstellen & Wechseln" : "Create & Switch",
            async (newName) => {
              const res = await this.git.createBranch(newName);
              if (res.ok) {
                new Notice(isDe ? `Branch erstellt: ${newName}` : `Created branch: ${newName}`);
                await this.refresh();
              } else {
                new Notice(isDe ? `Erstellen fehlgeschlagen: ${res.error}` : `Branch creation failed: ${res.error}`);
              }
            },
          ).open();
        });
    });

    const rect = anchorEl.getBoundingClientRect();
    if (typeof (menu as any).showAtPosition === 'function') {
      (menu as any).showAtPosition({ x: rect.left, y: rect.bottom + 4 }, anchorEl.ownerDocument);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.feedbackTimer !== null) {
      window.clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.inputEl?.removeEventListener('input', this.boundInput);
  }
}

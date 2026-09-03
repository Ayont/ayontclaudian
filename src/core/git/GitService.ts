import { spawn } from 'node:child_process';

import { getEnhancedPath } from '../../utils/env';

/** A single changed path from `git status --porcelain`. */
export interface GitFileChange {
  /** Repo-relative path (the new path for renames). */
  path: string;
  /** Staged (index) status char, e.g. `M`, `A`, `D`, `R`, `?`, ` `. */
  index: string;
  /** Unstaged (worktree) status char. */
  worktree: string;
  /** True when the change is at least partly staged. */
  staged: boolean;
  /** True for untracked files (`??`). */
  untracked: boolean;
}

export interface GitStatus {
  branch: string | null;
  files: GitFileChange[];
}

export interface GitResult {
  ok: boolean;
  error?: string;
}

const MAX_DIFF_BYTES = 60_000;

interface GitRun {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Parses `git status --porcelain=v1 -z` output.
 *
 * NUL-separated entries; each is `XY<space><path>`. Rename/copy entries (`R`/`C`
 * in the index slot) are followed by an extra NUL-terminated original-path
 * token which is consumed. `??` marks untracked files.
 */
export function parsePorcelainStatus(output: string): GitFileChange[] {
  const files: GitFileChange[] = [];
  const tokens = output.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (entry.length < 3) {
      continue;
    }
    const index = entry[0];
    const worktree = entry[1];
    const path = entry.slice(3);
    if (!path) {
      continue;
    }
    // Rename/copy carries the original path in the following token — consume it.
    if (index === 'R' || index === 'C') {
      i++;
    }
    const untracked = index === '?' && worktree === '?';
    files.push({
      path,
      index,
      worktree,
      untracked,
      staged: !untracked && index !== ' ',
    });
  }
  return files;
}

/** Ahead/behind counts vs the configured upstream branch. */
export interface AheadBehind {
  /** Local commits not yet on upstream (`↑`). */
  ahead: number;
  /** Upstream commits not yet local (`↓`). */
  behind: number;
}

/**
 * Normalizes a git remote URL to a canonical `https://github.com/owner/repo`
 * link. Handles SSH (`git@github.com:owner/repo.git`), the `ssh://` form, and
 * `https://github.com/owner/repo(.git)`. Returns `null` for any non-GitHub
 * remote so callers can fall back to a plain display.
 *
 * Pure and exported so it can be unit-tested in isolation.
 */
export function toGitHubHttpsUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  // scp-like SSH: git@github.com:owner/repo(.git)
  const scpMatch = trimmed.match(/^(?:[^@]+@)?github\.com:(.+)$/i);
  if (scpMatch) {
    return buildGitHubUrl(scpMatch[1]);
  }

  // URL forms: https://github.com/..., ssh://git@github.com/..., git://github.com/...
  const urlMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/(.+)$/i);
  if (urlMatch) {
    return buildGitHubUrl(urlMatch[1]);
  }

  return null;
}

/** Strips a trailing `.git`/slash from an `owner/repo` path and rebuilds the canonical URL. */
function buildGitHubUrl(path: string): string | null {
  const cleaned = path
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .trim();
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const [owner, repo] = segments;
  return `https://github.com/${owner}/${repo}`;
}

/**
 * Thin wrapper around the `git` CLI scoped to one working directory. Runs each
 * command as a child process with a PATH-enhanced env so `git` resolves even
 * under Obsidian's minimal GUI environment. Never throws — failures come back
 * as `{ ok: false, error }`.
 */
export class GitService {
  constructor(private readonly cwd: string) {}

  private run(args: string[], maxBytes = Infinity): Promise<GitRun> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let proc;
      try {
        proc = spawn('git', args, {
          cwd: this.cwd,
          env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
          windowsHide: true,
        });
      } catch (error) {
        resolve({ stdout: '', stderr: error instanceof Error ? error.message : 'spawn failed', code: -1 });
        return;
      }
      proc.stdout?.on('data', (chunk: Buffer | string) => {
        if (stdout.length < maxBytes) {
          stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        }
      });
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.on('error', (error) => resolve({ stdout, stderr: stderr || error.message, code: -1 }));
      proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  }

  async isRepo(): Promise<boolean> {
    const result = await this.run(['rev-parse', '--is-inside-work-tree']);
    return result.code === 0 && result.stdout.trim() === 'true';
  }

  async init(): Promise<GitResult> {
    const result = await this.run(['init']);
    return result.code === 0 ? { ok: true } : { ok: false, error: result.stderr.trim() || 'git init failed' };
  }

  async currentBranch(): Promise<string | null> {
    const result = await this.run(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async status(): Promise<GitStatus> {
    const [branch, status] = await Promise.all([
      this.currentBranch(),
      this.run(['status', '--porcelain=v1', '-z']),
    ]);
    return { branch, files: parsePorcelainStatus(status.stdout) };
  }

  /** Combined staged + unstaged diff vs HEAD, capped for model prompts. */
  async diff(): Promise<string> {
    const result = await this.run(['diff', '--no-color', 'HEAD'], MAX_DIFF_BYTES);
    return result.stdout.slice(0, MAX_DIFF_BYTES);
  }

  /** Stages everything and commits with `message`. */
  async commitAll(message: string): Promise<GitResult> {
    const trimmed = message.trim();
    if (!trimmed) {
      return { ok: false, error: 'Commit message is empty' };
    }
    const add = await this.run(['add', '-A']);
    if (add.code !== 0) {
      return { ok: false, error: add.stderr.trim() || 'git add failed' };
    }
    const commit = await this.run(['commit', '-m', trimmed]);
    if (commit.code !== 0) {
      return { ok: false, error: commit.stderr.trim() || commit.stdout.trim() || 'git commit failed' };
    }
    return { ok: true };
  }

  async push(): Promise<GitResult> {
    const result = await this.run(['push']);
    return result.code === 0 ? { ok: true } : { ok: false, error: result.stderr.trim() || 'git push failed' };
  }

  /**
   * URL of the `origin` remote, falling back to the first configured remote.
   * Returns `null` when the repo has no remotes (or the command fails).
   */
  async getRemoteUrl(): Promise<string | null> {
    const origin = await this.run(['remote', 'get-url', 'origin']);
    if (origin.code === 0) {
      const url = origin.stdout.trim();
      if (url) {
        return url;
      }
    }
    // No `origin` — try the first remote name, if any.
    const remotes = await this.run(['remote']);
    if (remotes.code !== 0) {
      return null;
    }
    const first = remotes.stdout.split('\n').map((line) => line.trim()).find(Boolean);
    if (!first) {
      return null;
    }
    const byName = await this.run(['remote', 'get-url', first]);
    if (byName.code !== 0) {
      return null;
    }
    return byName.stdout.trim() || null;
  }

  /**
   * Ahead/behind commit counts of the current branch vs its upstream. Returns
   * `null` when there is no upstream (e.g. a fresh branch) or the command fails.
   */
  async aheadBehind(): Promise<AheadBehind | null> {
    const result = await this.run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    if (result.code !== 0) {
      return null;
    }
    // Output is `<behind>\t<ahead>`: left side = upstream-only, right side = local-only.
    const parts = result.stdout.trim().split(/\s+/);
    if (parts.length < 2) {
      return null;
    }
    const behind = Number.parseInt(parts[0], 10);
    const ahead = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
      return null;
    }
    return { ahead, behind };
  }

  /**
   * Lists local git branches and marks the active HEAD branch.
   */
  async listBranches(): Promise<{ name: string; current: boolean }[]> {
    const result = await this.run(["branch", "--list", "--no-color"]);
    if (result.code !== 0) {
      return [];
    }
    const lines = result.stdout.split("\n");
    const branches: { name: string; current: boolean }[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const isCurrent = line.startsWith("* ");
      const name = line.replace(/^[*+ ]\s*/, "").trim();
      if (name && !name.includes("(HEAD detached")) {
        branches.push({ name, current: isCurrent });
      }
    }
    return branches;
  }

  /**
   * Switches/checkouts an existing branch.
   */
  async checkoutBranch(branchName: string): Promise<GitResult> {
    const trimmed = branchName.trim();
    if (!trimmed) {
      return { ok: false, error: "Branch name is empty" };
    }
    const result = await this.run(["checkout", trimmed]);
    return result.code === 0 ? { ok: true } : { ok: false, error: result.stderr.trim() || "git checkout failed" };
  }

  /**
   * Creates and switches to a new branch.
   */
  async createBranch(branchName: string): Promise<GitResult> {
    const trimmed = branchName.trim();
    if (!trimmed) {
      return { ok: false, error: "Branch name is empty" };
    }
    const result = await this.run(["checkout", "-b", trimmed]);
    return result.code === 0 ? { ok: true } : { ok: false, error: result.stderr.trim() || "git checkout -b failed" };
  }
}


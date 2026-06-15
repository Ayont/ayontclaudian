import { createMockEl } from '@test/helpers/mockElement';

import type { GitFileChange } from '@/core/git/GitService';
import { CommitBar, describeChangeCount, suggestCommitMessage } from '@/features/chat/ui/CommitBar';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

function makeFile(path: string): GitFileChange {
  return { path, index: 'M', worktree: ' ', staged: true, untracked: false };
}

function createMockGit(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    isRepo: jest.fn().mockResolvedValue(true),
    status: jest.fn().mockResolvedValue({ branch: 'main', files: [makeFile('a.ts')] }),
    commitAll: jest.fn().mockResolvedValue({ ok: true }),
    push: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findByClass(root: any, cls: string): any {
  return root.querySelector(`.${cls}`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('suggestCommitMessage', () => {
  test('returns empty string when there are no changes', () => {
    expect(suggestCommitMessage([])).toBe('');
  });

  test('lists basenames for a small set of changes', () => {
    const msg = suggestCommitMessage([makeFile('src/a.ts'), makeFile('src/b.ts')]);
    expect(msg).toBe('update: a.ts, b.ts');
  });

  test('caps the list and appends a +N more suffix', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(makeFile);
    expect(suggestCommitMessage(files)).toBe('update: a.ts, b.ts, c.ts (+2 more)');
  });

  test('uses basename of nested and backslash paths', () => {
    const msg = suggestCommitMessage([makeFile('deep/nested/file.ts'), makeFile('win\\path\\x.ts')]);
    expect(msg).toBe('update: file.ts, x.ts');
  });
});

describe('describeChangeCount', () => {
  test('handles zero, singular, and plural', () => {
    expect(describeChangeCount(0)).toBe('No changes');
    expect(describeChangeCount(1)).toBe('1 changed file');
    expect(describeChangeCount(3)).toBe('3 changed files');
  });
});

describe('CommitBar', () => {
  test('stays hidden when the workspace is not a git repo', async () => {
    const parent = createMockEl();
    const git = createMockGit({ isRepo: jest.fn().mockResolvedValue(false) });
    new CommitBar(parent, git as never);
    await flush();

    const bar = findByClass(parent, 'claudian-commit-bar');
    expect(bar.hasClass('claudian-hidden')).toBe(true);
    expect(git.status).not.toHaveBeenCalled();
  });

  test('shows branch and change count when in a repo', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    const bar = findByClass(parent, 'claudian-commit-bar');
    expect(bar.hasClass('claudian-hidden')).toBe(false);
    expect(findByClass(parent, 'claudian-commit-bar-branch-name').textContent).toBe('main');
    expect(findByClass(parent, 'claudian-commit-bar-count').textContent).toBe('1 changed file');
  });

  test('commit is disabled with an empty message and enabled once typed', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    const commitBtn = findByClass(parent, 'claudian-commit-bar-commit');
    expect(commitBtn.hasClass('claudian-commit-bar-disabled')).toBe(true);

    const input = findByClass(parent, 'claudian-commit-bar-input');
    input.value = 'feat: thing';
    input.dispatchEvent('input');
    expect(commitBtn.hasClass('claudian-commit-bar-disabled')).toBe(false);
  });

  test('suggest button fills the input from changed files', async () => {
    const parent = createMockEl();
    const git = createMockGit({
      status: jest.fn().mockResolvedValue({ branch: 'dev', files: [makeFile('x.ts'), makeFile('y.ts')] }),
    });
    new CommitBar(parent, git as never);
    await flush();

    findByClass(parent, 'claudian-commit-bar-suggest').click();
    expect(findByClass(parent, 'claudian-commit-bar-input').value).toBe('update: x.ts, y.ts');
  });

  test('commit re-checks status and calls commitAll, then refreshes', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    const input = findByClass(parent, 'claudian-commit-bar-input');
    input.value = 'chore: update';
    input.dispatchEvent('input');

    findByClass(parent, 'claudian-commit-bar-commit').click();
    await flush();
    await flush();

    expect(git.commitAll).toHaveBeenCalledWith('chore: update');
    expect(git.push).not.toHaveBeenCalled();
    // status() called at mount + at execution-time re-check + post-commit refresh.
    expect(git.status.mock.calls.length).toBeGreaterThanOrEqual(2);
    const feedback = findByClass(parent, 'claudian-commit-bar-feedback');
    expect(feedback.hasClass('claudian-commit-bar-feedback-success')).toBe(true);
  });

  test('commit & push calls both commitAll and push', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    const input = findByClass(parent, 'claudian-commit-bar-input');
    input.value = 'release';
    input.dispatchEvent('input');

    findByClass(parent, 'claudian-commit-bar-push').click();
    await flush();
    await flush();

    expect(git.commitAll).toHaveBeenCalledWith('release');
    expect(git.push).toHaveBeenCalledTimes(1);
  });

  test('surfaces git stderr inline when commit fails', async () => {
    const parent = createMockEl();
    const git = createMockGit({
      commitAll: jest.fn().mockResolvedValue({ ok: false, error: 'nothing to commit' }),
    });
    new CommitBar(parent, git as never);
    await flush();

    const input = findByClass(parent, 'claudian-commit-bar-input');
    input.value = 'bad commit';
    input.dispatchEvent('input');

    findByClass(parent, 'claudian-commit-bar-commit').click();
    await flush();
    await flush();

    const feedback = findByClass(parent, 'claudian-commit-bar-feedback');
    expect(feedback.hasClass('claudian-commit-bar-feedback-error')).toBe(true);
    const text = findByClass(parent, 'claudian-commit-bar-feedback-text');
    expect(text.textContent).toBe('nothing to commit');
    expect(git.push).not.toHaveBeenCalled();
  });

  test('does not throw when isRepo rejects', async () => {
    const parent = createMockEl();
    const git = createMockGit({ isRepo: jest.fn().mockRejectedValue(new Error('boom')) });
    expect(() => new CommitBar(parent, git as never)).not.toThrow();
    await flush();
    expect(findByClass(parent, 'claudian-commit-bar').hasClass('claudian-hidden')).toBe(true);
  });

  test('destroy removes the input listener and is idempotent', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    const bar = new CommitBar(parent, git as never);
    await flush();

    const input = findByClass(parent, 'claudian-commit-bar-input');
    expect(input.getEventListenerCount('input')).toBe(1);
    bar.destroy();
    expect(input.getEventListenerCount('input')).toBe(0);
    expect(() => bar.destroy()).not.toThrow();
  });
});

import { createMockEl } from '@test/helpers/mockElement';

import type { GitFileChange } from '@/core/git/GitService';
import { toGitHubHttpsUrl } from '@/core/git/GitService';
import { CommitBar, describeChangeCount, suggestCommitMessage } from '@/features/chat/ui/CommitBar';


function makeFile(path: string): GitFileChange {
  return { path, index: 'M', worktree: ' ', staged: true, untracked: false };
}

function createMockGit(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    isRepo: jest.fn().mockResolvedValue(true),
    status: jest.fn().mockResolvedValue({ branch: 'main', files: [makeFile('a.ts')] }),
    commitAll: jest.fn().mockResolvedValue({ ok: true }),
    push: jest.fn().mockResolvedValue({ ok: true }),
    getRemoteUrl: jest.fn().mockResolvedValue(null),
    aheadBehind: jest.fn().mockResolvedValue(null),
    listBranches: jest.fn().mockResolvedValue([{ name: 'main', current: true }]),
    checkoutBranch: jest.fn().mockResolvedValue({ ok: true }),
    createBranch: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

 
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
  test("supports English change count formatting", () => {
    expect(describeChangeCount(0, "en")).toBe("No changes");
    expect(describeChangeCount(1, "en")).toBe("1 changed file");
    expect(describeChangeCount(4, "en")).toBe("4 changed files");
  });

  test('handles zero, singular, and plural in German and English', () => {
    expect(describeChangeCount(0, 'de')).toBe('Keine Änderungen');
    expect(describeChangeCount(1, 'de')).toBe('1 geänderte Datei');
    expect(describeChangeCount(3, 'de')).toBe('3 geänderte Dateien');
    expect(describeChangeCount(0, 'en')).toBe('No changes');
    expect(describeChangeCount(1, 'en')).toBe('1 changed file');
    expect(describeChangeCount(3, 'en')).toBe('3 changed files');
  });
});

describe('toGitHubHttpsUrl', () => {
  test('normalizes scp-style SSH remotes', () => {
    expect(toGitHubHttpsUrl('git@github.com:Ayont/ayontclaudian.git')).toBe(
      'https://github.com/Ayont/ayontclaudian',
    );
  });

  test('normalizes https remotes with and without .git', () => {
    expect(toGitHubHttpsUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
    expect(toGitHubHttpsUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });

  test('normalizes ssh:// remotes', () => {
    expect(toGitHubHttpsUrl('ssh://git@github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  test('returns null for non-GitHub or malformed remotes', () => {
    expect(toGitHubHttpsUrl('git@gitlab.com:owner/repo.git')).toBeNull();
    expect(toGitHubHttpsUrl('https://github.com/owner')).toBeNull();
    expect(toGitHubHttpsUrl('')).toBeNull();
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
    expect(findByClass(parent, 'claudian-commit-bar-count').textContent).toMatch(/^(?:1 changed file|1 geänderte Datei)$/);
  });

  test('uses native buttons and a live feedback region', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    expect(findByClass(parent, 'claudian-commit-bar-suggest').tagName).toBe('BUTTON');
    expect(findByClass(parent, 'claudian-commit-bar-commit').tagName).toBe('BUTTON');
    expect(findByClass(parent, 'claudian-commit-bar-push').tagName).toBe('BUTTON');
    expect(findByClass(parent, 'claudian-commit-bar-feedback').getAttribute('aria-live')).toBe('polite');
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

  test('shows the GitHub remote row with ahead/behind when a remote exists', async () => {
    const parent = createMockEl();
    const git = createMockGit({
      getRemoteUrl: jest.fn().mockResolvedValue('git@github.com:Ayont/ayontclaudian.git'),
      aheadBehind: jest.fn().mockResolvedValue({ ahead: 2, behind: 1 }),
    });
    new CommitBar(parent, git as never);
    await flush();

    const repoRow = findByClass(parent, 'claudian-commit-bar-repo');
    expect(repoRow.hasClass('claudian-hidden')).toBe(false);
    const link = findByClass(parent, 'claudian-commit-bar-remote');
    expect(link.getAttribute('href')).toBe('https://github.com/Ayont/ayontclaudian');
    expect(findByClass(parent, 'claudian-commit-bar-remote-name').textContent).toBe(
      'github.com/Ayont/ayontclaudian',
    );
    expect(findByClass(parent, 'claudian-commit-bar-sync-ahead').textContent).toBe('↑2');
    expect(findByClass(parent, 'claudian-commit-bar-sync-behind').textContent).toBe('↓1');
  });

  test('hides the remote row when there is no remote', async () => {
    const parent = createMockEl();
    const git = createMockGit();
    new CommitBar(parent, git as never);
    await flush();

    expect(findByClass(parent, 'claudian-commit-bar-repo').hasClass('claudian-hidden')).toBe(true);
  });


  test("renders clickable branch button with chevron and triggers branch list on click", async () => {
    const parent = createMockEl();
    const git = createMockGit({
      listBranches: jest.fn().mockResolvedValue([
        { name: "main", current: true },
        { name: "feature/awesome", current: false },
      ]),
    });
    new CommitBar(parent, git as never);
    await flush();

    const branchWrap = findByClass(parent, "claudian-commit-bar-branch");
    expect(branchWrap.hasClass("claudian-commit-bar-branch--clickable")).toBe(true);
    expect(branchWrap.getAttribute("role")).toBe("button");
    expect(findByClass(parent, "claudian-commit-bar-branch-chevron")).not.toBeNull();

    branchWrap.click();
    await flush();
    expect(git.listBranches).toHaveBeenCalled();
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

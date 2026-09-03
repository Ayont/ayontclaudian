import { GitService } from '@/core/git/GitService';

describe('GitService', () => {
  let git: GitService;
  let runMock: jest.SpyInstance;

  beforeEach(() => {
    git = new GitService('/vault/path');
    runMock = jest.spyOn(git as any, 'run');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listBranches', () => {
    it('returns empty array when git command fails', async () => {
      runMock.mockResolvedValue({ code: 1, stdout: '', stderr: 'fatal: not a git repository' });
      const branches = await git.listBranches();
      expect(branches).toEqual([]);
    });

    it('parses local branch names and flags the active one', async () => {
      runMock.mockResolvedValue({
        code: 0,
        stdout: '  main\n* feature/ui-refresh\n  develop\n',
        stderr: '',
      });
      const branches = await git.listBranches();
      expect(branches).toEqual([
        { name: 'main', current: false },
        { name: 'feature/ui-refresh', current: true },
        { name: 'develop', current: false },
      ]);
    });

    it('filters out detached HEAD states cleanly', async () => {
      runMock.mockResolvedValue({
        code: 0,
        stdout: '* (HEAD detached at 993f7b47)\n  main\n',
        stderr: '',
      });
      const branches = await git.listBranches();
      expect(branches).toEqual([{ name: 'main', current: false }]);
    });
  });

  describe('checkoutBranch', () => {
    it('returns error when branch name is empty', async () => {
      const res = await git.checkoutBranch('   ');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('empty');
    });

    it('runs checkout and returns success when git exit code is 0', async () => {
      runMock.mockResolvedValue({ code: 0, stdout: "Switched to branch 'develop'", stderr: '' });
      const res = await git.checkoutBranch('develop');
      expect(res.ok).toBe(true);
      expect(runMock).toHaveBeenCalledWith(['checkout', 'develop']);
    });

    it('returns error when checkout fails', async () => {
      runMock.mockResolvedValue({ code: 1, stdout: '', stderr: 'error: pathspec did not match' });
      const res = await git.checkoutBranch('missing');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('error: pathspec did not match');
    });
  });

  describe('createBranch', () => {
    it('returns error when branch name is empty', async () => {
      const res = await git.createBranch('');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('empty');
    });

    it('runs checkout -b and returns success when git exit code is 0', async () => {
      runMock.mockResolvedValue({ code: 0, stdout: "Switched to a new branch 'feature/v5'", stderr: '' });
      const res = await git.createBranch('feature/v5');
      expect(res.ok).toBe(true);
      expect(runMock).toHaveBeenCalledWith(['checkout', '-b', 'feature/v5']);
    });

    it('returns error when branch creation fails', async () => {
      runMock.mockResolvedValue({ code: 128, stdout: '', stderr: "fatal: A branch named 'main' already exists." });
      const res = await git.createBranch('main');
      expect(res.ok).toBe(false);
      expect(res.error).toBe("fatal: A branch named 'main' already exists.");
    });
  });
});

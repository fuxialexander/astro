import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { applyWorktreeInclude } from './worktree-include.js';
import { runSetupScript } from './worktree-setup.js';

const execFileAsync = promisify(execFile);

export interface WorktreeOptions {
  workingDirectory: string;
  taskId: string;
  rootOverride?: string;
  projectId?: string;
  nodeId?: string;
  stdout?: (data: string) => void;
  stderr?: (data: string) => void;
}

export interface WorktreeSetup {
  workingDirectory: string;
  branchName: string;
  cleanup: (options?: { keepBranch?: boolean }) => Promise<void>;
}

export async function createWorktree(
  options: WorktreeOptions,
): Promise<WorktreeSetup | null> {
  const {
    workingDirectory,
    taskId,
    rootOverride,
    projectId,
    nodeId,
    stdout,
    stderr,
  } = options;

  const resolvedWorkingDirectory = resolve(workingDirectory);
  const gitRoot = await getGitRoot(resolvedWorkingDirectory);

  // Require git repository to exist
  // Safety checks in task-executor.ts ensure git is initialized before reaching here
  if (!gitRoot) {
    throw new Error(`Not a git repository: ${resolvedWorkingDirectory}. Initialize git first.`);
  }

  const hasHead = await hasCommits(gitRoot);
  if (!hasHead) {
    throw new Error(`Git repository has no commits: ${gitRoot}. Create an initial commit first.`);
  }

  const repoName = sanitize(basename(gitRoot));
  const baseRoot = rootOverride ?? join(homedir(), '.nexus', 'worktrees', repoName);
  await mkdir(baseRoot, { recursive: true });

  const branchName = `nexus/${sanitize(taskId)}`;
  const worktreePath = join(baseRoot, sanitize(taskId));
  await rm(worktreePath, { recursive: true, force: true });
  await pruneWorktrees(gitRoot);
  await ensureBranchAvailable(gitRoot, branchName);

  await execFileAsync(
    'git',
    ['-C', gitRoot, 'worktree', 'add', '-b', branchName, worktreePath],
    { env: withGitEnv(), timeout: 30_000 }
  );

  // Orchestration: include files + setup script (both non-fatal)
  const log = stdout;
  try {
    await applyWorktreeInclude({ gitRoot, worktreePath, log });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr?.(`worktree-include failed: ${msg}`);
  }

  try {
    await runSetupScript({
      gitRoot,
      worktreePath,
      taskId,
      projectId,
      nodeId,
      stdout,
      stderr,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr?.(`setup script failed: ${msg}`);
  }

  const relativePath = relative(gitRoot, resolvedWorkingDirectory);
  const useRelativePath =
    relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath) && relativePath !== '.';
  const worktreeWorkingDirectory = useRelativePath
    ? join(worktreePath, relativePath)
    : worktreePath;

  return {
    workingDirectory: worktreeWorkingDirectory,
    branchName,
    cleanup: async (options?: { keepBranch?: boolean }) => {
      await cleanupWorktree(gitRoot, worktreePath, branchName, options?.keepBranch);
    },
  };
}

async function getGitRoot(workingDirectory: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workingDirectory, 'rev-parse', '--show-toplevel'],
      { env: withGitEnv(), timeout: 5_000 }
    );
    const root = stdout.trim();
    return root ? resolve(root) : null;
  } catch {
    return null;
  }
}

async function ensureBranchAvailable(gitRoot: string, branchName: string): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', gitRoot, 'branch', '-D', branchName],
      { env: withGitEnv(), timeout: 10_000 }
    );
  } catch {
    // Branch didn't exist — that's fine
  }
}

async function cleanupWorktree(
  gitRoot: string,
  worktreePath: string,
  branchName: string,
  keepBranch?: boolean,
): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', gitRoot, 'worktree', 'remove', '--force', worktreePath],
      { env: withGitEnv(), timeout: 30_000 }
    );
    await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune'], {
      env: withGitEnv(),
      timeout: 30_000,
    });
  } catch {
    // Ignore - worktree may already be removed
  }

  try {
    await rm(worktreePath, { recursive: true, force: true });
  } catch {
    // Ignore - directory may not exist
  }

  // Skip branch deletion when keepBranch is true (e.g., PR was created)
  if (!keepBranch) {
    try {
      await execFileAsync(
        'git',
        ['-C', gitRoot, 'branch', '-D', branchName],
        { env: withGitEnv(), timeout: 10_000 }
      );
    } catch {
      // Ignore - branch may not exist or already deleted
    }
  }
}

async function pruneWorktrees(gitRoot: string): Promise<void> {
  try {
    await execFileAsync('git', ['-C', gitRoot, 'worktree', 'prune'], {
      env: withGitEnv(),
      timeout: 30_000,
    });
  } catch {
    // Ignore prune errors
  }
}

async function hasCommits(gitRoot: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', gitRoot, 'rev-parse', '--verify', 'HEAD'], {
      env: withGitEnv(),
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function withGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

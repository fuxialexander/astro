/**
 * Repo utilities for agent runner.
 *
 * Lightweight versions of the core repo setup logic (isGitRepo, getFileTree,
 * getGitRemoteUrl) that run on remote machines. Skips .gitignore/CLAUDE.md
 * generation since the repo already exists on the remote machine.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function getFileTree(dir: string): string[] {
  if (!existsSync(dir)) return [];

  try {
    const output = execFileSync('git', ['ls-files'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function getGitRemoteUrl(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: 'pipe',
    }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

export interface LocalRepoSetupResult {
  success: boolean;
  workingDirectory?: string;
  fileTree?: string[];
  repository?: string;
  needsGitInit?: boolean;
  error?: string;
}

/**
 * Clone a git repository to ~/.nexus/repos/<projectId>/.
 * If already cloned, fetch latest. Returns the local path.
 */
function cloneRepository(repoUrl: string, projectId: string): string {
  const repoDir = join(homedir(), '.nexus', 'repos', projectId);

  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — fetch latest
    try {
      execSync('git fetch --all', { cwd: repoDir, stdio: 'ignore', timeout: 30_000 });
    } catch {
      // Non-fatal: proceed with stale clone
    }
  } else {
    // Ensure parent directory exists
    mkdirSync(join(homedir(), '.nexus', 'repos'), { recursive: true });
    // Clone the repo
    execSync(`git clone ${JSON.stringify(repoUrl)} ${JSON.stringify(repoDir)}`, {
      stdio: 'ignore',
      timeout: 120_000,
    });
  }
  return repoDir;
}

/**
 * Run repo setup locally on the agent runner's machine.
 * Handles existing directories and cloning repos from URL.
 */
export function localRepoSetup(options: {
  workingDirectory?: string;
  repository?: string;
  projectId?: string;
}): LocalRepoSetupResult {
  const { workingDirectory, repository, projectId } = options;

  if (!workingDirectory && !repository) {
    return { success: false, error: 'No working directory or repository provided' };
  }

  // If only a repo URL is provided, clone it locally
  if (repository && !workingDirectory) {
    try {
      const clonedDir = cloneRepository(repository, projectId || crypto.randomUUID().slice(0, 8));
      const fileTree = getFileTree(clonedDir);
      return {
        success: true,
        workingDirectory: clonedDir,
        fileTree,
        repository,
      };
    } catch (error) {
      return { success: false, error: `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  if (workingDirectory) {
    if (!existsSync(workingDirectory)) {
      return { success: false, error: `Directory does not exist: ${workingDirectory}` };
    }

    if (isGitRepo(workingDirectory)) {
      const fileTree = getFileTree(workingDirectory);
      const detectedRepo = getGitRemoteUrl(workingDirectory);
      return {
        success: true,
        workingDirectory,
        fileTree,
        repository: detectedRepo,
      };
    }

    // Not a git repo
    return {
      success: true,
      workingDirectory,
      fileTree: [],
      needsGitInit: true,
    };
  }

  return { success: false, error: 'Unexpected state' };
}

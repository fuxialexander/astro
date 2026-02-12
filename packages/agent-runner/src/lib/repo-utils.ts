/**
 * Repo utilities for agent runner.
 *
 * Lightweight versions of the core repo setup logic (isGitRepo, getFileTree,
 * getGitRemoteUrl) that run on remote machines. Skips .gitignore/CLAUDE.md
 * generation since the repo already exists on the remote machine.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
 * Run repo setup locally on the agent runner's machine.
 * Simpler than server's setupProjectRepo — only handles existing directories.
 */
export function localRepoSetup(options: {
  workingDirectory?: string;
  repository?: string;
}): LocalRepoSetupResult {
  const { workingDirectory, repository } = options;

  if (!workingDirectory && !repository) {
    return { success: false, error: 'No working directory or repository provided' };
  }

  // If only a repo URL is provided, we can't clone on the agent runner side
  // (that's handled by the server). Just report it.
  if (repository && !workingDirectory) {
    return { success: false, error: 'Cannot clone repository on remote machine — provide a working directory' };
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

/**
 * Repo utilities for agent runner.
 *
 * Lightweight versions of the core repo setup logic (isGitRepo, getFileTree,
 * getGitRemoteUrl) that run on remote machines. Skips .gitignore/CLAUDE.md
 * generation since the repo already exists on the remote machine.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

/** Key file contents read from the repo for context injection */
export interface RepoKeyFiles {
  claudeMd?: string;
  readmeMd?: string;
  packageInfo?: string;
}

export interface LocalRepoSetupResult {
  success: boolean;
  workingDirectory?: string;
  fileTree?: string[];
  repository?: string;
  needsGitInit?: boolean;
  keyFiles?: RepoKeyFiles;
  error?: string;
}

const KEY_FILE_CAP = 15_000;
const PKG_FILE_CAP = 5_000;

/**
 * Read key files from a directory for plan generation context.
 * Returns capped contents of CLAUDE.md, README.md, and package metadata.
 */
function readKeyFiles(dir: string): RepoKeyFiles {
  const result: RepoKeyFiles = {};

  function readCapped(path: string, cap: number): string | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const content = readFileSync(path, 'utf-8');
      return content.length > cap ? content.slice(0, cap) + '\n\n[... truncated ...]' : content;
    } catch { return undefined; }
  }

  result.claudeMd = readCapped(join(dir, 'CLAUDE.md'), KEY_FILE_CAP);
  result.readmeMd = readCapped(join(dir, 'README.md'), KEY_FILE_CAP) ?? readCapped(join(dir, 'readme.md'), KEY_FILE_CAP);

  const packageFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
  for (const pkg of packageFiles) {
    const content = readCapped(join(dir, pkg), PKG_FILE_CAP);
    if (content) {
      result.packageInfo = `# ${pkg}\n${content}`;
      break;
    }
  }

  return result;
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

  // Case 1: No directory and no repository — create a fresh project dir
  if (!workingDirectory && !repository) {
    if (!projectId) {
      return { success: false, error: 'Project ID is required when creating a new directory' };
    }
    try {
      const dir = join(homedir(), '.nexus', 'projects', projectId);
      mkdirSync(dir, { recursive: true });
      execSync('git init', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.name "Nexus Agent" || true', { cwd: dir, stdio: 'ignore' });
      execSync('git config user.email "agent@nexus.local" || true', { cwd: dir, stdio: 'ignore' });
      const fileTree = getFileTree(dir);
      return {
        success: true,
        workingDirectory: dir,
        fileTree,
      };
    } catch (error) {
      return { success: false, error: `Failed to create project directory: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // If only a repo URL is provided, clone it locally
  if (repository && !workingDirectory) {
    try {
      const clonedDir = cloneRepository(repository, projectId || crypto.randomUUID().slice(0, 8));
      const fileTree = getFileTree(clonedDir);
      const keyFiles = readKeyFiles(clonedDir);
      return {
        success: true,
        workingDirectory: clonedDir,
        fileTree,
        repository,
        keyFiles,
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
      const keyFiles = readKeyFiles(workingDirectory);
      return {
        success: true,
        workingDirectory,
        fileTree,
        repository: detectedRepo,
        keyFiles,
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

/**
 * SkyPilot Execution Strategy (Experimental Stub)
 *
 * Cloud VM provisioning via SkyPilot. Supports launching jobs on AWS, GCP,
 * Azure, and other clouds.
 */

import { spawn, exec, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  ExecutionStrategy,
  ExecutionSpec,
  ExecutionCallbacks,
  ExecutionResult,
  ExecutionStrategyDetection,
  ExecutionJobStatus,
} from './types.js';

const execAsync = promisify(exec);

export interface SkyPilotExecOptions {
  cluster?: string;
  cloud?: string;
  instanceType?: string;
  gpus?: string;
  numNodes?: number;
  /** If true, use `sky exec` on existing cluster instead of `sky launch` */
  reuseCluster?: boolean;
}

export class SkyPilotStrategy implements ExecutionStrategy {
  readonly id = 'skypilot' as const;
  readonly name = 'SkyPilot (Cloud)';
  readonly isAsync = true;

  /** Maps jobId → { cluster, skyJobId } */
  private jobs = new Map<string, { cluster: string; skyJobId?: string }>();
  private processes = new Map<string, ChildProcess>();

  /** Resolved sky binary path (may be inside a conda env) */
  private skyBinary = 'sky';

  async detect(): Promise<ExecutionStrategyDetection> {
    // Stage 1: Check if sky CLI is on PATH
    let skyPath: string | null = null;
    try {
      const { stdout } = await execAsync('which sky', { timeout: 5000 });
      skyPath = stdout.trim();
    } catch {
      // Not on PATH — try conda environments
    }

    // Stage 2: Scan common conda/mamba installation paths
    if (!skyPath) {
      skyPath = await this.findSkyInCondaEnvs();
    }

    if (!skyPath) {
      return { available: false };
    }

    this.skyBinary = skyPath;

    // Run sky check to get available clouds
    try {
      const { stdout } = await execAsync(`"${skyPath}" check 2>&1`, { timeout: 30000 });

      // Parse enabled clouds from sky check output
      const clouds: string[] = [];
      const enabledPattern = /(\w+):\s+enabled/gi;
      let match;
      while ((match = enabledPattern.exec(stdout)) !== null) {
        clouds.push(match[1]!.toLowerCase());
      }

      // Get sky version
      let version: string | undefined;
      try {
        const { stdout: verOut } = await execAsync(`"${skyPath}" --version 2>/dev/null`, { timeout: 5000 });
        version = verOut.trim();
      } catch {
        // Version detection failed
      }

      // Detect conda env name from path
      const condaEnv = this.parseCondaEnvFromPath(skyPath);

      return {
        available: clouds.length > 0,
        version,
        metadata: {
          enabledClouds: clouds,
          skyBinaryPath: skyPath,
          ...(condaEnv ? { condaEnv } : {}),
        },
      };
    } catch {
      return { available: false };
    }
  }

  /**
   * Scans common conda/mamba base directories for environments containing `sky`.
   * Checks: ~/miniconda3, ~/anaconda3, ~/mambaforge, ~/miniforge3, ~/miniforge,
   * plus $CONDA_PREFIX if set.
   */
  private async findSkyInCondaEnvs(): Promise<string | null> {
    const home = homedir();
    const condaBases = [
      join(home, 'miniconda3'),
      join(home, 'anaconda3'),
      join(home, 'mambaforge'),
      join(home, 'miniforge3'),
      join(home, 'miniforge'),
    ];

    // Also check CONDA_PREFIX (current active env's parent)
    if (process.env.CONDA_PREFIX) {
      // CONDA_PREFIX points to the active env, check its bin directly
      const directPath = join(process.env.CONDA_PREFIX, 'bin', 'sky');
      if (await this.isExecutable(directPath)) return directPath;
    }

    for (const base of condaBases) {
      // Check base env
      const baseBin = join(base, 'bin', 'sky');
      if (await this.isExecutable(baseBin)) return baseBin;

      // Check named environments
      const envsDir = join(base, 'envs');
      try {
        const envNames = await readdir(envsDir);
        for (const envName of envNames) {
          const envBin = join(envsDir, envName, 'bin', 'sky');
          if (await this.isExecutable(envBin)) return envBin;
        }
      } catch {
        // envs directory doesn't exist for this conda installation
      }
    }

    return null;
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Extracts conda environment name from a path like /home/user/miniconda3/envs/skypilot/bin/sky */
  private parseCondaEnvFromPath(skyPath: string): string | null {
    const match = skyPath.match(/\/envs\/([^/]+)\/bin\/sky$/);
    return match ? match[1]! : null;
  }

  async buildContext(): Promise<string> {
    const detection = await this.detect();
    if (!detection.available) return '';

    const meta = detection.metadata ?? {};
    const clouds = (meta.enabledClouds as string[]) ?? [];

    const sections: string[] = [];
    sections.push('# SkyPilot Cloud Execution Environment (Experimental)');
    sections.push('');
    sections.push('SkyPilot is available for cloud job execution.');
    if (clouds.length > 0) {
      sections.push(`- Enabled clouds: ${clouds.join(', ')}`);
    }
    const condaEnv = meta.condaEnv as string | undefined;
    if (condaEnv) {
      sections.push(`- SkyPilot is installed in conda environment: \`${condaEnv}\``);
      sections.push(`- Binary path: \`${meta.skyBinaryPath}\``);
    }
    sections.push('- Use `sky launch` to provision a cloud VM and run a job');
    sections.push('- Use `sky exec` to run on an existing cluster');
    sections.push('- Use `sky queue` to check job status');
    sections.push('- Use `sky cancel` to cancel running jobs');
    sections.push('- Use `sky down` to tear down clusters');
    sections.push('');

    return sections.join('\n');
  }

  async execute(
    spec: ExecutionSpec,
    callbacks: ExecutionCallbacks,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    if (signal.aborted) {
      return { status: 'cancelled' };
    }

    const opts = (spec.options ?? {}) as SkyPilotExecOptions;
    const cluster = opts.cluster || `astro-${spec.jobId.substring(0, 8)}`;
    const command = typeof spec.command === 'string' ? spec.command : spec.command.join(' ');

    // Build sky command arguments
    const skyCmd = opts.reuseCluster ? 'exec' : 'launch';
    const args: string[] = [skyCmd, '-c', cluster, '-y'];

    if (!opts.reuseCluster) {
      // Launch-specific options
      if (opts.cloud) args.push('--cloud', opts.cloud);
      if (opts.instanceType) args.push('--instance-type', opts.instanceType);
      if (opts.gpus) args.push('--gpus', opts.gpus);
      if (opts.numNodes) args.push('--num-nodes', String(opts.numNodes));
    }

    args.push('--', command);

    this.jobs.set(spec.jobId, { cluster });

    return new Promise<ExecutionResult>((resolve) => {
      const child = spawn(this.skyBinary, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.processes.set(spec.jobId, child);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: ExecutionResult) => {
        if (settled) return;
        settled = true;
        this.processes.delete(spec.jobId);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve(result);
      };

      // Handle abort signal
      const onAbort = () => {
        if (!settled) {
          child.kill('SIGTERM');
          // Also try sky cancel
          execAsync(`"${this.skyBinary}" cancel ${cluster} -a -y 2>/dev/null`, { timeout: 30000 }).catch(() => {});
          finish({
            status: 'cancelled',
            output: stdout,
            error: stderr,
            externalJobId: cluster,
          });
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });

      // Handle timeout
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (spec.timeout && spec.timeout > 0) {
        timeoutHandle = setTimeout(() => {
          if (!settled) {
            child.kill('SIGTERM');
            execAsync(`"${this.skyBinary}" cancel ${cluster} -a -y 2>/dev/null`, { timeout: 30000 }).catch(() => {});
            finish({
              status: 'timeout',
              output: stdout,
              error: stderr,
              externalJobId: cluster,
            });
          }
        }, spec.timeout);
        timeoutHandle.unref();
      }

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        callbacks.onStdout(text);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        callbacks.onStderr(text);
      });

      child.on('error', (err) => {
        finish({
          status: 'failed',
          error: err.message,
          output: stdout,
          externalJobId: cluster,
        });
      });

      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        const exitCode = code ?? 1;
        finish({
          status: exitCode === 0 ? 'completed' : 'failed',
          exitCode,
          output: stdout,
          error: stderr || undefined,
          externalJobId: cluster,
        });
      });

      callbacks.onStatus('provisioning', 0, `SkyPilot ${skyCmd} cluster ${cluster}`);
    });
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Kill the local sky process
    const child = this.processes.get(jobId);
    if (child) {
      child.kill('SIGTERM');
      this.processes.delete(jobId);
    }

    // Cancel jobs on the cluster
    try {
      await execAsync(`"${this.skyBinary}" cancel ${job.cluster} -a -y 2>/dev/null`, { timeout: 30000 });
    } catch {
      // Cluster might not exist or already be down
    }

    this.jobs.delete(jobId);
  }

  async getStatus(jobId: string): Promise<ExecutionJobStatus | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    try {
      const { stdout } = await execAsync(
        `"${this.skyBinary}" queue ${job.cluster} 2>/dev/null`,
        { timeout: 15000 },
      );

      // Parse sky queue output (simplified — real parsing would be more robust)
      const lines = stdout.trim().split('\n');
      // Find the most recent job line
      const jobLine = lines[lines.length - 1];
      if (jobLine) {
        const parts = jobLine.trim().split(/\s+/);
        const skyJobId = parts[0];
        const state = parts[1] ?? 'UNKNOWN';
        return {
          jobId,
          externalJobId: skyJobId || job.cluster,
          state,
        };
      }
    } catch {
      // sky queue failed — cluster might not exist
    }

    return null;
  }
}

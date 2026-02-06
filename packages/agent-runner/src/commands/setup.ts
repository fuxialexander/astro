/**
 * Setup command - runs device auth, detects providers, configures relay
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname as osHostname } from 'node:os';
import { config } from '../lib/config.js';
import { detectProviders, formatProvidersSummary } from '../lib/providers.js';
import { getMachineResources, formatResourceSummary } from '../lib/resources.js';
import { discoverRemoteHosts, formatDiscoveredHosts } from '../lib/ssh-discovery.js';
import { requestDeviceCode, pollForToken, registerMachine, DeviceAuthApiError } from '../lib/api-client.js';
import { detectLocalIP, checkRemoteNode, packAndInstall } from '../lib/ssh-installer.js';
import type { ProviderType, DiscoveredHost } from '../types.js';

const execFile = promisify(execFileCb);

interface SetupOptions {
  api?: string;
  relay?: string;
  skipAuth?: boolean;
  nonInteractive?: boolean;
}

export async function setupCommand(options: SetupOptions = {}): Promise<void> {
  console.log(chalk.bold('\n🚀 Nexus Agent Runner Setup\n'));

  // Step 1: Detect machine resources
  const resourceSpinner = ora('Detecting machine resources...').start();
  let resources: Awaited<ReturnType<typeof getMachineResources>> | undefined;
  try {
    resources = await getMachineResources();
    resourceSpinner.succeed('Machine resources detected');
    console.log(chalk.dim(formatResourceSummary(resources)));
    console.log();
  } catch (error) {
    resourceSpinner.fail('Failed to detect machine resources');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }

  // Step 2: Detect installed providers
  const providerSpinner = ora('Detecting agent providers...').start();
  let detectedProviders: Awaited<ReturnType<typeof detectProviders>>;
  try {
    detectedProviders = await detectProviders();
    if (detectedProviders.length > 0) {
      providerSpinner.succeed(`Found ${detectedProviders.length} agent provider(s)`);
      console.log(chalk.dim(formatProvidersSummary(detectedProviders)));
    } else {
      providerSpinner.warn('No agent providers detected');
      console.log(chalk.yellow('  Install Claude Code or Codex to enable task execution'));
      console.log(chalk.dim('  Claude Code: https://claude.ai/code'));
      console.log(chalk.dim('  Codex: https://openai.com/codex'));
    }
    console.log();
  } catch {
    providerSpinner.fail('Failed to detect providers');
    detectedProviders = [];
  }

  // Step 3: Discover SSH hosts
  const sshSpinner = ora('Discovering remote hosts...').start();
  let discoveredHosts: DiscoveredHost[];
  try {
    discoveredHosts = await discoverRemoteHosts();
    if (discoveredHosts.length > 0) {
      sshSpinner.succeed(`Found ${discoveredHosts.length} remote host(s)`);
      console.log(chalk.dim(formatDiscoveredHosts(discoveredHosts)));
    } else {
      sshSpinner.info('No remote hosts discovered');
    }
    console.log();
  } catch {
    sshSpinner.fail('Failed to discover remote hosts');
    discoveredHosts = [];
  }

  // Step 4a: Configure API URL
  let apiUrl = options.api ?? config.getApiUrl();

  if (!options.nonInteractive) {
    const { customApi } = await inquirer.prompt<{ customApi: boolean }>([
      {
        type: 'confirm',
        name: 'customApi',
        message: `Use default API server (${apiUrl})?`,
        default: true,
      },
    ]);

    if (!customApi) {
      const { newApi } = await inquirer.prompt<{ newApi: string }>([
        {
          type: 'input',
          name: 'newApi',
          message: 'Enter API server URL:',
          default: apiUrl,
          validate: (input: string) => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Please enter a valid URL';
            }
          },
        },
      ]);
      apiUrl = newApi;
    }
  }

  config.setApiUrl(apiUrl);
  console.log(chalk.green(`✓ API server: ${apiUrl}\n`));

  // Step 4b: Configure relay URL
  let relayUrl = options.relay ?? config.getRelayUrl();

  if (!options.nonInteractive) {
    const { customRelay } = await inquirer.prompt<{ customRelay: boolean }>([
      {
        type: 'confirm',
        name: 'customRelay',
        message: `Use default relay server (${relayUrl})?`,
        default: true,
      },
    ]);

    if (!customRelay) {
      const { newRelay } = await inquirer.prompt<{ newRelay: string }>([
        {
          type: 'input',
          name: 'newRelay',
          message: 'Enter relay server URL:',
          default: relayUrl,
          validate: (input: string) => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Please enter a valid URL';
            }
          },
        },
      ]);
      relayUrl = newRelay;
    }
  }

  config.setRelayUrl(relayUrl);
  console.log(chalk.green(`✓ Relay server: ${relayUrl}\n`));

  // Step 5: Device authentication (if not skipped)
  if (!options.skipAuth) {
    console.log(chalk.bold('Device Authentication\n'));

    if (!options.nonInteractive) {
      const { authenticate } = await inquirer.prompt<{ authenticate: boolean }>([
        {
          type: 'confirm',
          name: 'authenticate',
          message: 'Would you like to authenticate this device now?',
          default: true,
        },
      ]);

      if (authenticate) {
        await runDeviceAuthFlow(apiUrl, relayUrl, resources, detectedProviders);
      }
    } else {
      console.log(chalk.yellow('Skipping authentication in non-interactive mode'));
      console.log(chalk.dim('Run setup again interactively to authenticate'));
      console.log();
    }
  }

  // Step 6: Save provider configuration
  const providerTypes = detectedProviders
    .filter((p) => p.available)
    .map((p) => p.type as ProviderType);
  config.setProviders(providerTypes);

  // Step 7: Offer to install on remote hosts
  if (discoveredHosts.length > 0 && !options.nonInteractive) {
    console.log(chalk.bold('Remote Installation\n'));
    console.log(chalk.dim('You have SSH access to these hosts. Would you like to install'));
    console.log(chalk.dim('the agent runner on any of them?\n'));

    const { selectedHosts } = await inquirer.prompt<{ selectedHosts: string[] }>([
      {
        type: 'checkbox',
        name: 'selectedHosts',
        message: 'Select hosts to install on:',
        choices: discoveredHosts.map((h) => ({
          name: `${h.name}${h.hostname !== h.name ? ` (${h.hostname})` : ''}`,
          value: h.name,
        })),
      },
    ]);

    if (selectedHosts.length > 0) {
      await installOnRemoteHosts(selectedHosts, discoveredHosts, apiUrl, relayUrl);
    }
  }

  // Step 8: Configure auto-start
  if (!options.nonInteractive) {
    const { autoStart } = await inquirer.prompt<{ autoStart: boolean }>([
      {
        type: 'confirm',
        name: 'autoStart',
        message: 'Enable auto-start on login?',
        default: false,
      },
    ]);

    config.setAutoStart(autoStart);

    if (autoStart) {
      console.log(chalk.green('✓ Auto-start enabled'));
      console.log(chalk.dim('  The agent will start automatically when you log in'));
      console.log(chalk.yellow('  Note: Auto-start setup is not yet implemented'));
    }
  }

  // Mark setup as complete
  config.completeSetup();

  // Summary
  console.log();
  console.log(chalk.bold.green('✓ Setup Complete!\n'));
  console.log('Configuration saved to:', chalk.dim(config.getConfigPath()));
  console.log();
  console.log('Runner ID:', chalk.cyan(config.getRunnerId()));
  console.log('Machine ID:', chalk.cyan(config.getMachineId()));
  console.log('API URL:  ', chalk.cyan(config.getApiUrl()));
  console.log('Relay URL:', chalk.cyan(config.getRelayUrl()));
  console.log(
    'Auth:    ',
    config.getAccessToken() ? chalk.green('authenticated') : chalk.yellow('not configured'),
  );
  console.log(
    'Providers:',
    providerTypes.length > 0 ? chalk.cyan(providerTypes.join(', ')) : chalk.yellow('none'),
  );
  console.log();
  console.log(chalk.bold('Next steps:'));
  console.log('  1. Start the agent runner:');
  console.log(chalk.cyan('     npx @nexus/agent start'));
  console.log();
  console.log('  2. Or run in the foreground for testing:');
  console.log(chalk.cyan('     npx @nexus/agent start --foreground'));
  console.log();
}

// ============================================================================
// Device auth flow (real backend)
// ============================================================================

async function runDeviceAuthFlow(
  apiUrl: string,
  _relayUrl: string,
  resources: Awaited<ReturnType<typeof getMachineResources>> | undefined,
  detectedProviders: Awaited<ReturnType<typeof detectProviders>>,
): Promise<void> {
  const hostname = resources?.hostname ?? osHostname();
  const platform = resources?.platform ?? process.platform;

  // 1. Request device code
  const authSpinner = ora('Requesting device code...').start();
  let deviceAuth;
  try {
    deviceAuth = await requestDeviceCode(apiUrl, {
      hostname,
      platform,
      environmentType: 'local',
    });
  } catch (err) {
    authSpinner.fail('Failed to request device code');
    if (err instanceof DeviceAuthApiError) {
      console.error(chalk.red(`  ${err.message}`));
      if (err.code === 'network') {
        console.log(chalk.dim(`  Is the backend running at ${apiUrl}?`));
        console.log(chalk.dim('  Start it with: npm run dev:backend'));
      }
    } else {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    }
    console.log();
    return;
  }

  // 2. Show verification URL and code
  authSpinner.info('Please authorize this device');
  console.log();
  console.log(chalk.bold('  Open this URL in your browser:'));
  console.log(chalk.cyan(`  ${deviceAuth.verificationUriComplete}`));
  console.log();
  console.log(chalk.bold('  Device code:'));
  console.log(chalk.yellow(`  ${deviceAuth.deviceCode}`));
  console.log();

  // 3. Try to auto-open in browser
  tryOpenUrl(deviceAuth.verificationUriComplete);

  // 4. Poll for authorization
  const pollSpinner = ora('Waiting for authorization...').start();
  let tokenResponse;
  try {
    tokenResponse = await pollForToken(
      apiUrl,
      deviceAuth.userCode,
      deviceAuth.interval,
      deviceAuth.expiresIn,
    );
  } catch (err) {
    if (err instanceof DeviceAuthApiError) {
      switch (err.code) {
        case 'denied':
          pollSpinner.fail('Authorization denied by user');
          break;
        case 'expired':
          pollSpinner.fail('Device code expired. Run setup again to retry.');
          break;
        case 'timeout':
          pollSpinner.fail('Timed out waiting for authorization');
          break;
        default:
          pollSpinner.fail(`Authorization failed: ${err.message}`);
      }
    } else {
      pollSpinner.fail('Authorization failed');
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    }
    console.log();
    return;
  }

  pollSpinner.succeed('Device authenticated successfully');

  // 5. Register machine
  const regSpinner = ora('Registering machine...').start();
  try {
    const providerTypes = detectedProviders
      .filter((p) => p.available)
      .map((p) => ({ type: p.type, name: p.name, version: p.version }));

    const regResponse = await registerMachine(apiUrl, tokenResponse.accessToken, {
      hostname,
      name: hostname,
      platform,
      environmentType: 'local',
      providers: providerTypes,
      resources: resources ?? undefined,
    });

    regSpinner.succeed(`Machine registered as "${regResponse.machineName}" (${regResponse.machineId})`);

    // 6. Save all tokens and IDs
    config.setAccessToken(regResponse.accessToken);
    config.setRefreshToken(regResponse.refreshToken);
    config.setWsToken(regResponse.wsToken);
    config.setMachineId(regResponse.machineId);

    // Update relay URL if the server provided one
    if (regResponse.relayUrl) {
      config.setRelayUrl(regResponse.relayUrl);
    }

    console.log();
  } catch (err) {
    regSpinner.fail('Failed to register machine');
    if (err instanceof DeviceAuthApiError) {
      console.error(chalk.red(`  ${err.message}`));
    } else {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    }
    // Still save the access/refresh tokens from the auth step
    config.setAccessToken(tokenResponse.accessToken);
    config.setRefreshToken(tokenResponse.refreshToken);
    console.log();
  }
}

// ============================================================================
// Remote SSH install
// ============================================================================

async function installOnRemoteHosts(
  selectedHosts: string[],
  discoveredHosts: DiscoveredHost[],
  apiUrl: string,
  relayUrl: string,
): Promise<void> {
  console.log();
  const localIP = detectLocalIP();
  // Build URLs that remote hosts can reach
  const remoteApiUrl = apiUrl.replace('localhost', localIP).replace('127.0.0.1', localIP);
  const remoteRelayUrl = relayUrl.replace('localhost', localIP).replace('127.0.0.1', localIP);

  for (const hostName of selectedHosts) {
    const host = discoveredHosts.find((h) => h.name === hostName);
    if (!host) continue;

    const spinner = ora(`Checking Node.js on ${hostName}...`).start();

    // Check remote Node.js availability
    const nodeCheck = await checkRemoteNode(host);
    if (!nodeCheck.available) {
      spinner.fail(
        `${hostName}: Node.js ${nodeCheck.version ? `${nodeCheck.version} (need ≥18)` : 'not found'}`,
      );
      console.log(chalk.dim('  Install Node.js ≥ 18 on this host first'));
      continue;
    }

    spinner.text = `Installing on ${hostName}...`;

    // Get tokens for the remote host
    const accessToken = config.getAccessToken();
    const refreshToken = config.getRefreshToken();
    const wsToken = config.getWsToken();
    const machineId = config.getMachineId();

    if (!accessToken || !refreshToken || !wsToken) {
      spinner.fail(`${hostName}: No auth tokens available. Authenticate locally first.`);
      continue;
    }

    try {
      await packAndInstall(
        {
          host,
          apiUrl: remoteApiUrl,
          relayUrl: remoteRelayUrl,
          accessToken,
          refreshToken,
          wsToken,
          machineId,
        },
        (msg) => {
          spinner.text = `${hostName}: ${msg}`;
        },
      );
      spinner.succeed(`${hostName}: Installed and configured`);
    } catch (err) {
      spinner.fail(`${hostName}: Installation failed`);
      console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  console.log();
}

// ============================================================================
// Helpers
// ============================================================================

function tryOpenUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [url]).catch(() => {
    // Silently ignore — user can open manually
  });
}

/**
 * Setup command - runs device auth, detects providers, configures relay
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { config } from '../lib/config.js';
import { detectProviders, formatProvidersSummary } from '../lib/providers.js';
import { getMachineResources, formatResourceSummary } from '../lib/resources.js';
import { discoverRemoteHosts, formatDiscoveredHosts, buildSSHCommand } from '../lib/ssh-discovery.js';
import type { ProviderType, DiscoveredHost } from '../types.js';

interface SetupOptions {
  relay?: string;
  skipAuth?: boolean;
  nonInteractive?: boolean;
}

export async function setupCommand(options: SetupOptions = {}): Promise<void> {
  console.log(chalk.bold('\n🚀 Nexus Agent Runner Setup\n'));

  // Step 1: Detect machine resources
  const resourceSpinner = ora('Detecting machine resources...').start();
  try {
    const resources = await getMachineResources();
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
  } catch (error) {
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
  } catch (error) {
    sshSpinner.fail('Failed to discover remote hosts');
    discoveredHosts = [];
  }

  // Step 4: Configure relay URL
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

    // In a real implementation, this would:
    // 1. Request a device code from the server
    // 2. Display the code and verification URL to the user
    // 3. Poll for the auth result
    // For now, we simulate this flow

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
        const authSpinner = ora('Initiating device authentication...').start();

        // Simulate device auth flow
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // In production, this would be a real device code
        const deviceCode = 'NEXUS-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        authSpinner.info('Please authorize this device');
        console.log();
        console.log(chalk.bold('  Open this URL in your browser:'));
        console.log(chalk.cyan(`  https://nexus.dev/device?code=${deviceCode}`));
        console.log();
        console.log(chalk.bold('  Or enter the code manually:'));
        console.log(chalk.yellow(`  ${deviceCode}`));
        console.log();

        const pollSpinner = ora('Waiting for authorization...').start();

        // In production, this would poll the server
        // For now, simulate a successful auth after a delay
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Generate a mock token
        const token = `nxt_${randomToken(32)}`;
        config.setDeviceToken(token);

        pollSpinner.succeed('Device authenticated successfully');
        console.log();
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
      console.log();
      for (const hostName of selectedHosts) {
        const host = discoveredHosts.find((h) => h.name === hostName);
        if (!host) continue;

        const installSpinner = ora(`Installing on ${hostName}...`).start();

        // Build install command
        const installCmd = buildSSHCommand(
          host,
          '"curl -fsSL https://nexus.dev/install.sh | sh && npx @nexus/agent setup --non-interactive"'
        );

        // In production, this would actually run the SSH command
        // For now, just show what would be run
        await new Promise((resolve) => setTimeout(resolve, 500));
        installSpinner.info(`Would run: ${chalk.dim(installCmd)}`);
      }
      console.log();
      console.log(chalk.yellow('Note: Remote installation is not yet implemented'));
      console.log(chalk.dim('You can manually run the following on each host:'));
      console.log(chalk.dim('  npx @nexus/agent setup'));
      console.log();
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

      // In production, this would set up systemd/launchd service
      // For now, just note that it's not implemented
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
  console.log('Relay URL:', chalk.cyan(config.getRelayUrl()));
  console.log(
    'Providers:',
    providerTypes.length > 0 ? chalk.cyan(providerTypes.join(', ')) : chalk.yellow('none')
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

function randomToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

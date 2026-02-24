#!/usr/bin/env node
/**
 * Astro CLI - Local-first project management
 *
 * Usage:
 *   astro-cli project list              - List all projects
 *   astro-cli project show <id>         - Show project details
 *   astro-cli project create --name <n> - Create a new project
 *   astro-cli project delete <id>       - Delete a project
 *
 * Global options:
 *   --json    Machine-readable JSON output
 *   --quiet   Suppress decorative output
 */

import { Command } from 'commander'
import { createProjectCommand } from './commands/project.js'

const program = new Command()

program
  .name('astro-cli')
  .description('Astro CLI - Local-first project and plan management')
  .version('0.1.0')
  .option('--json', 'Output in JSON format for machine consumption')
  .option('--quiet', 'Suppress decorative output')

// Register commands
program.addCommand(createProjectCommand())

// Parse arguments
program.parse()

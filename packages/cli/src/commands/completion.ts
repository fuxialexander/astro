import type { Command } from 'commander'

function generateBashCompletion(program: Command): string {
  const topLevel = (program.commands as Command[]).map(c => c.name()).join(' ')

  return `# bash completion for astro-cli
_astro_cli_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Top-level commands
  commands="${topLevel}"

  case "\${prev}" in
${(program.commands as Command[]).map(cmd => {
  const subs = (cmd.commands as Command[]).map(c => c.name()).join(' ')
  return `    ${cmd.name()})
      COMPREPLY=( $(compgen -W "${subs}" -- "\${cur}") )
      return 0
      ;;`
}).join('\n')}
  esac

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Options
  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "--json --quiet --server-url --help --version" -- "\${cur}") )
    return 0
  fi
}

complete -F _astro_cli_completions astro-cli
`
}

function generateZshCompletion(program: Command): string {
  const groups = (program.commands as Command[]).map(cmd => {
    const desc = cmd.description() ?? cmd.name()
    return `    '${cmd.name()}:${desc.replace(/'/g, "")}'`
  }).join('\n')

  const subcommandCases = (program.commands as Command[]).map(cmd => {
    const subs = (cmd.commands as Command[]).map(sub => {
      const desc = sub.description() ?? sub.name()
      return `        '${sub.name()}:${desc.replace(/'/g, "")}'`
    }).join('\n')
    if (!subs) return ''
    return `  ${cmd.name()})
    local -a subcmds
    subcmds=(
${subs}
    )
    _describe 'subcommand' subcmds
    ;;`
  }).filter(Boolean).join('\n')

  return `#compdef astro-cli

_astro-cli() {
  local -a commands
  commands=(
${groups}
  )

  _arguments -C \\
    '--json[Machine-readable JSON output]' \\
    '--quiet[Suppress spinners and decorative output]' \\
    '--server-url[Override server URL]:url:_urls' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case ${'$'}state in
  command)
    _describe 'command' commands
    ;;
  args)
    case ${'$'}words[1] in
${subcommandCases}
    esac
    ;;
  esac
}

_astro-cli "$@"
`
}

function generateFishCompletion(program: Command): string {
  const lines: string[] = [
    '# Fish completions for astro-cli',
    '',
    '# Disable file completions by default',
    'complete -c astro-cli -f',
    '',
    '# Global options',
    'complete -c astro-cli -l json -d "Machine-readable JSON output"',
    'complete -c astro-cli -l quiet -d "Suppress spinners and decorative output"',
    'complete -c astro-cli -l server-url -x -d "Override server URL"',
    '',
  ]

  for (const cmd of program.commands as Command[]) {
    const desc = cmd.description() ?? cmd.name()
    lines.push(`# ${cmd.name()} commands`)
    lines.push(`complete -c astro-cli -n "__fish_use_subcommand" -a "${cmd.name()}" -d "${desc.replace(/"/g, '\\"')}"`)

    for (const sub of cmd.commands as Command[]) {
      const subDesc = sub.description() ?? sub.name()
      lines.push(`complete -c astro-cli -n "__fish_seen_subcommand_from ${cmd.name()}" -a "${sub.name()}" -d "${subDesc.replace(/"/g, '\\"')}"`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function registerCompletionCommands(program: Command): void {
  program
    .command('completion')
    .description('Generate shell completion script')
    .option('--shell <shell>', 'Shell type: bash, zsh, fish', 'bash')
    .action((opts: { shell: string }) => {
      switch (opts.shell) {
        case 'bash':
          console.log(generateBashCompletion(program))
          break
        case 'zsh':
          console.log(generateZshCompletion(program))
          break
        case 'fish':
          console.log(generateFishCompletion(program))
          break
        default:
          console.error(`Unknown shell "${opts.shell}". Use bash, zsh, or fish.`)
          process.exitCode = 1
      }
    })
}

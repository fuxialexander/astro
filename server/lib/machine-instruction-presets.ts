/**
 * Server-side loader for machine instruction presets.
 * Reads markdown files from skills/machine_instruction_presets/ at startup.
 *
 * Source of truth: skills/machine_instruction_presets/*.md
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { MACHINE_INSTRUCTION_PRESET_META, DEFAULT_MACHINE_INSTRUCTION_NAME, formatMachineInstruction } from './prompt-templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESETS_DIR = process.env.ASTRO_SKILLS_DIR
  ? resolve(process.env.ASTRO_SKILLS_DIR, 'machine_instruction_presets')
  : resolve(__dirname, '../../skills/machine_instruction_presets')

function loadPresetFile(filename: string): string {
  try {
    return readFileSync(resolve(PRESETS_DIR, filename), 'utf-8').trim()
  } catch (err) {
    console.warn(`[machine-instruction-presets] Failed to load ${filename}:`, err instanceof Error ? err.message : String(err))
    return ''
  }
}

export interface MachineInstructionPreset {
  id: string
  name: string
  description: string
  content: string
}

/** All presets loaded from markdown files */
export const MACHINE_INSTRUCTION_PRESETS: MachineInstructionPreset[] =
  MACHINE_INSTRUCTION_PRESET_META.map((meta) => ({
    id: meta.id,
    name: meta.name,
    description: meta.description,
    content: loadPresetFile(meta.filename),
  }))

/** The default compute guide content (first preset) */
export const DEFAULT_MACHINE_INSTRUCTION =
  MACHINE_INSTRUCTION_PRESETS.find((p) => p.id === 'builtin:default')?.content ?? ''

/** Pre-formatted default instruction for system prompt assembly */
export const DEFAULT_MACHINE_INSTRUCTION_FORMATTED =
  formatMachineInstruction(DEFAULT_MACHINE_INSTRUCTION_NAME, DEFAULT_MACHINE_INSTRUCTION)

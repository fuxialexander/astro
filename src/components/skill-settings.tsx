import { useState } from "react"
import { useSkillStore } from "@/stores/skill-store"
import { parseSkillMd } from "@/lib/skill-loader"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Zap,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import type { OpenClawSkill } from "@/types/skill"

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  )
}

const sourceColors: Record<OpenClawSkill["source"], string> = {
  builtin: "bg-blue-500/10 text-blue-600",
  workspace: "bg-green-500/10 text-green-600",
  clawhub: "bg-purple-500/10 text-purple-600",
  plugin: "bg-orange-500/10 text-orange-600",
}

function SkillCard({ skill }: { skill: OpenClawSkill }) {
  const enableSkill = useSkillStore((s) => s.enableSkill)
  const disableSkill = useSkillStore((s) => s.disableSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)
  const updateSkillConfig = useSkillStore((s) => s.updateSkillConfig)
  const [expanded, setExpanded] = useState(false)
  const [apiKey, setApiKey] = useState(
    (skill.config?.apiKey as string) || ""
  )

  const handleApiKeySave = () => {
    updateSkillConfig(skill.name, { ...skill.config, apiKey })
  }

  const emoji = skill.metadata?.openclaw?.emoji || ""

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-muted/50 rounded"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              {emoji && <span className="text-sm">{emoji}</span>}
              <span className="text-sm font-medium truncate">{skill.name}</span>
              <Badge
                className={cn(
                  "text-[10px] py-0 h-4 border-0",
                  sourceColors[skill.source]
                )}
              >
                {skill.source}
              </Badge>
            </div>
            {skill.description && (
              <span className="text-[12px] text-muted-foreground truncate">
                {skill.description}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <Toggle
            checked={skill.enabled}
            onChange={(checked) =>
              checked ? enableSkill(skill.name) : disableSkill(skill.name)
            }
          />
          {skill.source !== "builtin" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeSkill(skill.name)}
              className="text-destructive hover:text-destructive h-8 w-8 p-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3.5 pl-12">
          {/* Instruction preview */}
          <div className="rounded-md bg-muted/30 p-3 mb-3">
            <span className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Instructions (preview)
            </span>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
              {skill.instructions.length > 500
                ? skill.instructions.slice(0, 500) + "..."
                : skill.instructions}
            </pre>
          </div>

          {/* API Key config (if skill has primaryEnv) */}
          {skill.metadata?.openclaw?.primaryEnv && (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`${skill.metadata.openclaw.primaryEnv}`}
                className="h-8 text-xs flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleApiKeySave}
                className="h-8 text-xs"
              >
                Save
              </Button>
            </div>
          )}

          {/* Requirements */}
          {skill.metadata?.openclaw?.requires && (
            <div className="mt-2">
              <span className="text-[11px] font-medium text-muted-foreground block mb-1">
                Requirements
              </span>
              <div className="flex flex-wrap gap-1">
                {skill.metadata.openclaw.requires.bins?.map((bin) => (
                  <Badge key={bin} variant="outline" className="text-[10px]">
                    {bin}
                  </Badge>
                ))}
                {skill.metadata.openclaw.requires.env?.map((env) => (
                  <Badge key={env} variant="outline" className="text-[10px]">
                    ${env}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SkillSettingsContent() {
  const skills = useSkillStore((s) => s.skills)
  const addSkill = useSkillStore((s) => s.addSkill)
  const [showAddSkill, setShowAddSkill] = useState(false)
  const [skillContent, setSkillContent] = useState("")

  const skillEntries = Array.from(skills.values())

  const handleAddSkill = () => {
    if (!skillContent.trim()) return
    try {
      const skill = parseSkillMd(skillContent.trim(), "workspace")
      addSkill(skill)
      setSkillContent("")
      setShowAddSkill(false)
    } catch (err) {
      console.error("[SkillSettings] Failed to parse SKILL.md:", err)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-semibold">Skills</h1>

      {/* Add Skill */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Skill</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddSkill(!showAddSkill)}
          >
            Paste SKILL.md
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Skills are agent-level extensions that inject instructions into AI agent prompts.
          Compatible with OpenClaw&apos;s SKILL.md format.
        </p>

        {showAddSkill && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              <textarea
                value={skillContent}
                onChange={(e) => setSkillContent(e.target.value)}
                placeholder={"---\nname: my-skill\ndescription: A custom skill\n---\n\nInstructions for the agent..."}
                className="h-[160px] w-full resize-none rounded-md border border-border bg-background p-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddSkill(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddSkill} disabled={!skillContent.trim()}>
                  Add Skill
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Installed Skills */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Installed Skills</h2>
        <div className="rounded-xl border border-border bg-card">
          {skillEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Zap className="mb-2 h-8 w-8" />
              <span className="text-sm">No skills installed</span>
              <span className="mt-1 text-xs">
                Paste a SKILL.md above or install from ClawHub
              </span>
            </div>
          ) : (
            skillEntries.map((skill) => (
              <SkillCard key={skill.name} skill={skill} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}

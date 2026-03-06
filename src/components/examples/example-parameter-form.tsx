import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import type { UseCaseParameter } from "@astro/core/templates"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { useExampleStore } from "@/stores/example-store"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react"

interface ExampleParameterFormProps {
  /** Parameters to render in the form */
  parameters: UseCaseParameter[]
  /** Current parameter values */
  values: Record<string, unknown>
  /** Validation errors from the template store */
  errors: Array<{ parameterId: string; message: string }>
  /** Callback when a parameter value changes */
  onChange: (parameterId: string, value: unknown) => void
  /** Whether to show advanced options by default */
  defaultExpandAdvanced?: boolean
}

/**
 * ExampleParameterForm - Dynamic form for template parameters
 *
 * Features:
 * - Auto-generates form from UseCaseParameter[] schema
 * - Field type mapping (string→Input, textarea→Textarea, etc.)
 * - Required params shown prominently, optional in collapsible "Advanced Options"
 * - Conditional visibility via visibleWhen
 * - Real-time validation (debounced)
 * - Default values pre-populated
 * - Error display per field
 * - Display groups for parameter organization
 */
export function ExampleParameterForm({
  parameters,
  values,
  errors,
  onChange,
  defaultExpandAdvanced = false,
}: ExampleParameterFormProps) {
  const [expandedAdvanced, setExpandedAdvanced] = useState(defaultExpandAdvanced)
  const validateParameters = useExampleStore((s) => s.validateParameters)

  // Group parameters by required/optional
  const { requiredParams, optionalParams } = useMemo(() => {
    const required = parameters.filter((p) => p.required)
    const optional = parameters.filter((p) => !p.required)

    // Sort by order within each group
    const sortByOrder = (a: UseCaseParameter, b: UseCaseParameter) =>
      (a.order ?? 0) - (b.order ?? 0)

    return {
      requiredParams: required.sort(sortByOrder),
      optionalParams: optional.sort(sortByOrder),
    }
  }, [parameters])

  // Group parameters by their display group
  const groupedRequired = useMemo(() => groupByDisplayGroup(requiredParams), [requiredParams])
  const groupedOptional = useMemo(() => groupByDisplayGroup(optionalParams), [optionalParams])

  // Check if a parameter should be visible based on visibleWhen condition
  const isParameterVisible = useCallback(
    (param: UseCaseParameter): boolean => {
      if (!param.visibleWhen) return true

      const condition = param.visibleWhen
      const dependencyValue = values[condition.parameterId]

      switch (condition.operator) {
        case "equals":
          return dependencyValue === condition.value
        case "not-equals":
          return dependencyValue !== condition.value
        case "contains":
          if (Array.isArray(dependencyValue)) {
            return dependencyValue.includes(condition.value)
          }
          if (typeof dependencyValue === "string") {
            return dependencyValue.includes(String(condition.value))
          }
          return false
        case "not-empty":
          if (Array.isArray(dependencyValue)) {
            return dependencyValue.length > 0
          }
          return !!dependencyValue
        default:
          return true
      }
    },
    [values]
  )

  // Debounced validation using ref to avoid stale closures
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null)

  const triggerValidation = useCallback(() => {
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current)
    }
    validationTimerRef.current = setTimeout(() => {
      validateParameters()
    }, 500) // 500ms debounce
  }, [validateParameters])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current)
      }
    }
  }, [])

  // Wrapped onChange that triggers validation
  const handleChange = useCallback(
    (parameterId: string, value: unknown) => {
      onChange(parameterId, value)
      triggerValidation()
    },
    [onChange, triggerValidation]
  )

  // Get error message for a specific parameter
  const getError = useCallback(
    (parameterId: string): string | undefined => {
      return errors.find((e) => e.parameterId === parameterId)?.message
    },
    [errors]
  )

  return (
    <div className="space-y-6">
      {/* Required Parameters */}
      {groupedRequired.size > 0 && (
        <div className="space-y-4">
          {Array.from(groupedRequired.entries()).map(([groupName, params]) => (
            <ParameterGroup
              key={groupName}

              parameters={params}
              values={values}
              errors={errors}
              onChange={handleChange}
              isParameterVisible={isParameterVisible}
              getError={getError}
            />
          ))}
        </div>
      )}

      {/* Optional Parameters (Collapsible "Advanced Options") */}
      {optionalParams.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setExpandedAdvanced(!expandedAdvanced)}
            className="flex w-full items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {expandedAdvanced ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Advanced Options</span>
            <span className="text-xs font-normal text-muted-foreground">
              ({optionalParams.filter(isParameterVisible).length} optional)
            </span>
          </button>
          {expandedAdvanced && (
            <div className="space-y-4 pl-2 border-l-2 border-border">
              {Array.from(groupedOptional.entries()).map(([groupName, params]) => (
                <ParameterGroup
                  key={groupName}

                  parameters={params}
                  values={values}
                  errors={errors}
                  onChange={handleChange}
                  isParameterVisible={isParameterVisible}
                  getError={getError}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ParameterGroup - Renders a group of parameters
 */
interface ParameterGroupProps {
  parameters: UseCaseParameter[]
  values: Record<string, unknown>
  errors: Array<{ parameterId: string; message: string }>
  onChange: (parameterId: string, value: unknown) => void
  isParameterVisible: (param: UseCaseParameter) => boolean
  getError: (parameterId: string) => string | undefined
}

function ParameterGroup({
  parameters,
  values,
  onChange,
  isParameterVisible,
  getError,
}: ParameterGroupProps) {
  // Filter visible parameters
  const visibleParams = parameters.filter(isParameterVisible)

  if (visibleParams.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {visibleParams.map((param) => (
          <ParameterField
            key={param.id}
            parameter={param}
            value={values[param.id]}
            error={getError(param.id)}
            onChange={(value) => onChange(param.id, value)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * ParameterField - Renders a single parameter input field
 */
interface ParameterFieldProps {
  parameter: UseCaseParameter
  value: unknown
  error?: string
  onChange: (value: unknown) => void
}

function ParameterField({ parameter, value, error, onChange }: ParameterFieldProps) {
  const { id, name, description, type, required, placeholder, options, validation } = parameter

  // Render field based on type
  const renderField = () => {
    switch (type) {
      case "string":
        return (
          <Input
            id={id}
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(error && "border-red-500 focus-visible:ring-red-500")}
          />
        )

      case "textarea":
        return (
          <Textarea
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={1}
            className={cn(
              "min-h-[36px] resize-y",
              error && "border-red-500 focus-visible:ring-red-500"
            )}
          />
        )

      case "number":
        return (
          <Input
            id={id}
            type="number"
            value={(value as number) ?? ""}
            onChange={(e) => onChange(e.target.valueAsNumber)}
            placeholder={placeholder}
            min={validation?.min}
            max={validation?.max}
            className={cn(error && "border-red-500 focus-visible:ring-red-500")}
          />
        )

      case "boolean":
        return (
          <div className="flex items-center gap-2">
            <Switch
              id={id}
              checked={Boolean(value)}
              onCheckedChange={onChange}
              className={cn(error && "border-red-500")}
            />
            <Label htmlFor={id} className="text-sm text-muted-foreground cursor-pointer">
              {description}
            </Label>
          </div>
        )

      case "select":
        return (
          <Select value={String(value ?? "")} onValueChange={onChange}>
            <SelectTrigger
              id={id}
              className={cn(error && "border-red-500 focus:ring-red-500")}
            >
              <SelectValue placeholder={placeholder ?? "Select an option"} />
            </SelectTrigger>
            <SelectContent>
              {options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case "multi-select":
        return (
          <MultiSelectField
            id={id}
            options={options ?? []}
            value={(value as string[]) ?? []}
            onChange={onChange}
            placeholder={placeholder}
            error={error}
          />
        )

      case "file-path":
        return (
          <div className="flex gap-2">
            <Input
              id={id}
              type="text"
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder ?? "/path/to/file"}
              className={cn("flex-1", error && "border-red-500 focus-visible:ring-red-500")}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // In a real implementation, this would open a file picker
                // For now, it's a placeholder
                console.log("File picker not yet implemented")
              }}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        )

      case "code":
        return (
          <Textarea
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              "font-mono text-xs min-h-[120px]",
              error && "border-red-500 focus-visible:ring-red-500"
            )}
          />
        )

      default:
        // Fallback to textarea for unknown types
        return (
          <Textarea
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(error && "border-red-500 focus-visible:ring-red-500")}
          />
        )
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium">
          {name}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        {validation?.message && !error && (
          <span className="text-xs text-muted-foreground">{validation.message}</span>
        )}
      </div>
      {description && type !== "boolean" && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {renderField()}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

/**
 * MultiSelectField - Checkbox group for multi-select parameters
 */
interface MultiSelectFieldProps {
  id: string
  options: Array<{ label: string; value: string; description?: string }>
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  error?: string
}

function MultiSelectField({ id, options, value, onChange, error }: MultiSelectFieldProps) {
  const handleToggle = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue]
    onChange(newValue)
  }

  return (
    <div className={cn("space-y-2 rounded-md border p-3", error && "border-red-500")}>
      {options.map((option) => (
        <div key={option.value} className="flex items-start gap-2">
          <Checkbox
            id={`${id}-${option.value}`}
            checked={value.includes(option.value)}
            onCheckedChange={() => handleToggle(option.value)}
          />
          <Label
            htmlFor={`${id}-${option.value}`}
            className="text-sm font-normal cursor-pointer"
          >
            {option.label}
          </Label>
        </div>
      ))}
    </div>
  )
}

/**
 * Helper: Group parameters by display group
 */
function groupByDisplayGroup(params: UseCaseParameter[]): Map<string, UseCaseParameter[]> {
  const groups = new Map<string, UseCaseParameter[]>()

  for (const param of params) {
    const groupName = param.group ?? "_ungrouped"
    if (!groups.has(groupName)) {
      groups.set(groupName, [])
    }
    groups.get(groupName)!.push(param)
  }

  return groups
}

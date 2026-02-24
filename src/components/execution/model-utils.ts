/**
 * Returns styling info for a model item in the dropdown.
 */
export function getModelItemStyle(
  model: string,
  selectedModel: string,
  defaultModel: string | undefined
): { itemClassName: string; isSelected: boolean; isDefault: boolean; badgeVariant: "completed" | "secondary" } {
  const isSelected = selectedModel === model
  const isDefault = model === defaultModel
  const itemClassName = isSelected
    ? "gap-2 bg-success/10 text-success font-medium"
    : "gap-2"
  const badgeVariant = isSelected && isDefault ? "completed" as const : "secondary" as const
  return { itemClassName, isSelected, isDefault, badgeVariant }
}

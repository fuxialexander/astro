import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COLOR_PALETTE,
  PROJECT_ICONS,
  INITIATIVE_ICONS,
} from "@/lib/color-icon-utils";

interface ColorIconPickerProps {
  color?: string;
  icon?: string;
  type?: "project" | "initiative";
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  className?: string;
}

export function ColorIconPicker({
  color = "#3b82f6",
  icon = "📋",
  type = "project",
  onColorChange,
  onIconChange,
  className,
}: ColorIconPickerProps) {
  const icons = type === "initiative" ? INITIATIVE_ICONS : PROJECT_ICONS;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Icon Picker */}
      {onIconChange && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-9 w-9 p-0 text-xl hover:bg-accent"
              title="Change icon"
            >
              {icon}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="grid grid-cols-6 gap-1">
              {icons.map((emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  className={cn(
                    "h-9 w-9 p-0 text-xl hover:bg-accent",
                    icon === emoji && "bg-accent"
                  )}
                  onClick={() => onIconChange(emoji)}
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Color Picker */}
      {onColorChange && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-9 w-9 p-0 hover:bg-accent"
              title="Change color"
            >
              <div
                className="h-5 w-5 rounded-sm border"
                style={{ backgroundColor: color }}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="grid grid-cols-8 gap-1">
              {COLOR_PALETTE.map((c) => (
                <Button
                  key={c}
                  variant="ghost"
                  className={cn(
                    "h-8 w-8 p-0 hover:scale-110 transition-transform",
                    color === c && "ring-2 ring-offset-2 ring-primary"
                  )}
                  onClick={() => onColorChange(c)}
                >
                  <div
                    className="h-6 w-6 rounded-sm"
                    style={{ backgroundColor: c }}
                  />
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// Compact version that shows icon and color together as a single badge
interface ColorIconBadgeProps {
  color?: string;
  icon?: string;
  type?: "project" | "initiative";
  editable?: boolean;
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  className?: string;
}

export function ColorIconBadge({
  color = "#3b82f6",
  icon = "📋",
  type = "project",
  editable = false,
  onColorChange,
  onIconChange,
  className,
}: ColorIconBadgeProps) {
  const icons = type === "initiative" ? INITIATIVE_ICONS : PROJECT_ICONS;

  if (!editable) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium",
          className
        )}
        style={{ backgroundColor: `${color}15`, color }}
      >
        <span className="text-base">{icon}</span>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {/* Icon Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-7 w-7 p-0 text-base hover:bg-accent"
            title="Change icon"
          >
            {icon}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="grid grid-cols-6 gap-1">
            {icons.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                className={cn(
                  "h-9 w-9 p-0 text-xl hover:bg-accent",
                  icon === emoji && "bg-accent"
                )}
                onClick={() => onIconChange?.(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Color Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-accent"
            title="Change color"
          >
            <div
              className="h-4 w-4 rounded-sm border"
              style={{ backgroundColor: color }}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="grid grid-cols-8 gap-1">
            {COLOR_PALETTE.map((c) => (
              <Button
                key={c}
                variant="ghost"
                className={cn(
                  "h-8 w-8 p-0 hover:scale-110 transition-transform",
                  color === c && "ring-2 ring-offset-2 ring-primary"
                )}
                onClick={() => onColorChange?.(c)}
              >
                <div
                  className="h-6 w-6 rounded-sm"
                  style={{ backgroundColor: c }}
                />
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

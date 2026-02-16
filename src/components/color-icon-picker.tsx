import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLOR_PALETTE,
  PROJECT_FA_ICONS,
  INITIATIVE_FA_ICONS,
  PROJECT_EMOJI_ICONS,
  INITIATIVE_EMOJI_ICONS,
} from "@/lib/color-icon-utils";
import * as FaIcons from "react-icons/fa";

interface ColorIconPickerProps {
  color?: string;
  icon?: string;
  type?: "project" | "initiative";
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  className?: string;
}

export function ColorIconPicker({
  color = "#6366f1",
  icon = "FaBox",
  type = "project",
  onColorChange,
  onIconChange,
  className,
}: ColorIconPickerProps) {
  const [selectedColor, setSelectedColor] = useState(color);
  const [searchQuery, setSearchQuery] = useState("");
  const [tabValue, setTabValue] = useState<"icons" | "emojis">("icons");

  const faIcons = type === "initiative" ? INITIATIVE_FA_ICONS : PROJECT_FA_ICONS;
  const emojiIcons = type === "initiative" ? INITIATIVE_EMOJI_ICONS : PROJECT_EMOJI_ICONS;

  // Filter icons based on search
  const filteredFaIcons = useMemo(() => {
    if (!searchQuery) return faIcons;
    const query = searchQuery.toLowerCase();
    return faIcons.filter((iconName) => iconName.toLowerCase().includes(query));
  }, [faIcons, searchQuery]);

  const filteredEmojiIcons = useMemo(() => {
    if (!searchQuery) return emojiIcons;
    // For emojis, we can't really search by name, so just return all
    return emojiIcons;
  }, [emojiIcons, searchQuery]);

  const handleColorChange = (newColor: string) => {
    setSelectedColor(newColor);
    onColorChange?.(newColor);
  };

  const handleIconChange = (newIcon: string) => {
    onIconChange?.(newIcon);
  };

  // Get the current icon component (FA or emoji)
  const CurrentIcon = icon.startsWith("Fa") && icon in FaIcons
    ? FaIcons[icon as keyof typeof FaIcons]
    : null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Combined Icon & Color Picker */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 w-9 p-0 hover:bg-accent"
            title="Change icon and color"
          >
            {CurrentIcon ? (
              <CurrentIcon size={18} style={{ color: selectedColor }} />
            ) : (
              <span className="text-lg">{icon}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[520px] p-0" align="start">
          <Tabs value={tabValue} onValueChange={(v) => setTabValue(v as "icons" | "emojis")} className="w-full">
            <div className="border-b px-4 pt-3">
              <TabsList className="grid w-full grid-cols-2 mb-3">
                <TabsTrigger value="icons">Icons</TabsTrigger>
                <TabsTrigger value="emojis">Emojis</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-4 space-y-3">
              {/* Color Palette */}
              <div className="flex items-center gap-2 pb-3 border-b">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    className={cn(
                      "h-8 w-8 rounded-full transition-all flex items-center justify-center",
                      selectedColor === c && "ring-2 ring-offset-2 ring-primary"
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => handleColorChange(c)}
                  >
                    {selectedColor === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
                {/* Rainbow/custom color picker */}
                <button
                  className="h-8 w-8 rounded-full bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500"
                  title="More colors"
                  onClick={() => {/* TODO: Custom color picker */}}
                />
              </div>

              {/* Search */}
              <Input
                placeholder="Search icons..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9"
              />
            </div>

            {/* Icons Tab */}
            <TabsContent value="icons" className="px-4 pb-4 mt-0 max-h-[300px] overflow-y-auto">
              <div className="grid grid-cols-12 gap-1">
                {filteredFaIcons.map((iconName) => {
                  const IconComponent = FaIcons[iconName as keyof typeof FaIcons];
                  if (!IconComponent) return null;

                  return (
                    <Button
                      key={iconName}
                      variant="ghost"
                      className={cn(
                        "h-9 w-9 p-0 hover:bg-accent",
                        icon === iconName && "bg-accent"
                      )}
                      onClick={() => handleIconChange(iconName)}
                    >
                      <IconComponent size={18} style={{ color: selectedColor }} />
                    </Button>
                  );
                })}
              </div>
              {filteredFaIcons.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No icons found
                </div>
              )}
            </TabsContent>

            {/* Emojis Tab */}
            <TabsContent value="emojis" className="px-4 pb-4 mt-0 max-h-[300px] overflow-y-auto">
              <div className="grid grid-cols-12 gap-1">
                {filteredEmojiIcons.map((emoji) => (
                  <Button
                    key={emoji}
                    variant="ghost"
                    className={cn(
                      "h-9 w-9 p-0 text-lg hover:bg-accent",
                      icon === emoji && "bg-accent"
                    )}
                    onClick={() => handleIconChange(emoji)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
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
  color = "#6366f1",
  icon = "FaBox",
  type = "project",
  editable = false,
  onColorChange,
  onIconChange,
  className,
}: ColorIconBadgeProps) {
  // Get the icon component if it's a Font Awesome icon
  const IconComponent = icon.startsWith("Fa") && icon in FaIcons
    ? FaIcons[icon as keyof typeof FaIcons]
    : null;

  if (!editable) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium",
          className
        )}
        style={{ backgroundColor: `${color}15`, color }}
      >
        {IconComponent ? (
          <IconComponent size={14} />
        ) : (
          <span className="text-base">{icon}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center", className)}>
      <ColorIconPicker
        color={color}
        icon={icon}
        type={type}
        onColorChange={onColorChange}
        onIconChange={onIconChange}
      />
    </div>
  );
}

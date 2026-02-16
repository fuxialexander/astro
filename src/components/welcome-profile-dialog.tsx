import { useState, useEffect } from "react"
import { useUserProfileStore } from "@/stores/user-profile-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User, Sparkles } from "lucide-react"

/**
 * Welcome dialog shown on first login when user hasn't set a proper name
 * Prompts user to personalize their profile with their actual name
 */
export function WelcomeProfileDialog() {
  const profile = useUserProfileStore((s) => s.profile)
  const setName = useUserProfileStore((s) => s.setName)

  const [open, setOpen] = useState(false)
  const [name, setNameInput] = useState("")
  const [dismissed, setDismissed] = useState(false)

  // Check if we should show the dialog
  useEffect(() => {
    // Don't show if already dismissed this session
    if (dismissed) return

    // Check if name looks like an email or is empty
    const needsName = !profile.name ||
                     profile.name.includes("@") ||
                     profile.name.includes(".") && !profile.name.includes(" ")

    // Show dialog if name needs improvement
    if (needsName) {
      // Delay slightly to avoid showing immediately on page load
      const timer = setTimeout(() => setOpen(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [profile.name, dismissed])

  const handleSave = () => {
    if (name.trim()) {
      setName(name.trim())
      setOpen(false)
      setDismissed(true)
    }
  }

  const handleSkip = () => {
    setOpen(false)
    setDismissed(true)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">Welcome to Nexus!</DialogTitle>
          <DialogDescription className="text-center">
            We noticed you haven't set your name yet. Would you like to personalize your profile?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Your Name
            </Label>
            <Input
              id="profile-name"
              placeholder="e.g., John Smith"
              value={name}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyPress={handleKeyPress}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This will be displayed in your dashboard and profile
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleSkip}
            >
              Maybe Later
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!name.trim()}
            >
              Save Name
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            You can always change this later in Settings
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

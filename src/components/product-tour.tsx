import { useEffect, useRef } from "react"
import { driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"
import { isLocalMode } from "@/lib/app-mode"

const TOUR_COMPLETED_KEY = "astro-tour-completed"

export function ProductTour() {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    if (localStorage.getItem(TOUR_COMPLETED_KEY) === "true") return
    started.current = true

    const local = isLocalMode()

    const steps: DriveStep[] = [
      {
        element: '[data-tour-id="environments"]',
        popover: {
          title: "Environments",
          description:
            "Your connected machines appear here. Astro auto-detects compute backends like K8s, Docker, and SSH.",
        },
      },
      {
        element: '[data-tour-id="examples"]',
        popover: {
          title: "Examples",
          description:
            "Try a pre-built example to see how Astro works end-to-end.",
        },
      },
      {
        element: '[data-tour-id="plan"]',
        popover: {
          title: "Plan",
          description:
            "Start here to create a new project with AI-assisted planning.",
        },
      },
      {
        element: '[data-tour-id="projects"]',
        popover: {
          title: "Projects",
          description:
            "All your projects and their plan graphs live here.",
        },
      },
    ]

    if (!local) {
      steps.push({
        element: '[data-tour-id="community"]',
        popover: {
          title: "Community",
          description:
            "Browse and fork plans shared by other users.",
        },
      })
    }

    const timeout = setTimeout(() => {
      const tourDriver = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "astro-tour-popover",
        steps,
        onDestroyStarted: () => {
          localStorage.setItem(TOUR_COMPLETED_KEY, "true")
          tourDriver.destroy()
        },
      })

      tourDriver.drive()
    }, 500)

    return () => clearTimeout(timeout)
  }, [])

  return null
}

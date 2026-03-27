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
            "Connect your machines here. Each machine runs an agent runner that executes AI tasks in any working directory.",
        },
      },
      {
        element: '[data-tour-id="plan"]',
        popover: {
          title: "Plan & Project",
          description:
            "Start here to create a new project. Describe your goal and Astro will break it into a dependency graph of tasks that can be dispatched to your machines.",
        },
      },
      {
        element: '[data-tour-id="playground"]',
        popover: {
          title: "Playground",
          description:
            "Run single-session jobs without creating a full project. Great for quick experiments, one-off tasks, and trying things out.",
        },
      },
      {
        element: '[data-tour-id="active"]',
        popover: {
          title: "Active Jobs Hub",
          description:
            "Monitor all running tasks in one place. See live LLM output, send follow-up messages, and jump into any active session.",
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
      steps.push(
        {
          element: '[data-tour-id="github"]',
          popover: {
            title: "GitHub Sync",
            description:
              "Connect a GitHub repo to sync issues and pull requests with your project plan. Changes flow both ways — create issues from tasks, or import issues as plan nodes.",
          },
        },
        {
          element: '[data-tour-id="community"]',
          popover: {
            title: "Community",
            description:
              "Browse and fork plans shared by other users.",
          },
        },
      )
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

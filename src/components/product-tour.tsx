import { useEffect, useRef } from "react"
import { driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"
import { isLocalMode } from "@/lib/app-mode"

const TOUR_COMPLETED_KEY = "astro-tour-completed-v2"

export function ProductTour() {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    if (localStorage.getItem(TOUR_COMPLETED_KEY) === "true") return
    started.current = true

    const local = isLocalMode()

    const steps: DriveStep[] = [
      {
        element: '[data-tour-id="search"]',
        popover: {
          title: "Search & Command Palette",
          description:
            "Press ⌘K (or Ctrl+K) to instantly navigate anywhere, search projects, tasks, and references, or run commands. The fastest way to get around.",
        },
      },
      {
        element: '[data-tour-id="dashboard"]',
        popover: {
          title: "Dashboard",
          description:
            "Your home base. See recent projects, pending approvals, and a summary of what's happening across all your work.",
        },
      },
      {
        element: '[data-tour-id="projects"]',
        popover: {
          title: "Projects",
          description:
            "All your projects and their plan graphs live here. Each project breaks down a goal into a dependency graph of tasks that can be dispatched to your machines.",
        },
      },
      {
        element: '[data-tour-id="sessions"]',
        popover: {
          title: "Sessions",
          description:
            "Run single-session AI jobs without creating a full project. Great for quick experiments, one-off tasks, and trying things out.",
        },
      },
      {
        element: '[data-tour-id="active"]',
        popover: {
          title: "Active Jobs",
          description:
            "Monitor all running tasks in one place. See live AI output, send follow-up messages, and jump into any active session.",
        },
      },
      {
        element: '[data-tour-id="references"]',
        popover: {
          title: "References",
          description:
            "Manage your knowledge base — papers, documents, and web pages. References can be cited in tasks and plans to give your AI agents richer context.",
        },
      },
      {
        element: '[data-tour-id="environments"]',
        popover: {
          title: "Environments",
          description:
            "Connect your machines here. Each machine runs an agent runner that executes AI tasks in any working directory — local, HPC, or cloud.",
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
              "Browse and fork plans shared by other users. Find proven approaches for common goals and remix them for your own projects.",
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

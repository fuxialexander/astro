import { useEffect, useRef } from "react"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const INBOX_TOUR_KEY = "astro-inbox-tour-v1"

export function InboxTour() {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    if (localStorage.getItem(INBOX_TOUR_KEY) === "true") return
    started.current = true

    const timeout = setTimeout(() => {
      const planBtn = document.querySelector('[data-tour-id="plan-mode"]')
      const discoveryBtn = document.querySelector('[data-tour-id="discovery-mode"]')
      if (!planBtn && !discoveryBtn) return

      const tourDriver = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "astro-tour-popover",
        steps: [
          {
            element: '[data-tour-id="plan-mode"]',
            popover: {
              title: "Plan Mode",
              description:
                "When enabled, Astro first generates a structured dependency graph before executing — breaking your goal into parallel, ordered tasks. Toggle off for direct single-session execution. Shortcut: Shift+Tab.",
            },
          },
          {
            element: '[data-tour-id="discovery-mode"]',
            popover: {
              title: "Discovery Mode",
              description:
                "Designed for research and scientific workflows. Each task runs in its own isolated directory under <code>analysis/</code>, with scripts and outputs co-located. Parallel execution across branches, no git worktrees needed. Best for HPC / data analysis pipelines. <br><br><a href='/onboarding' style='color:#6ec07a;text-decoration:underline;font-size:0.8em'>See full workflow guide →</a>",
            },
          },
        ],
        onDestroyStarted: () => {
          localStorage.setItem(INBOX_TOUR_KEY, "true")
          tourDriver.destroy()
        },
      })

      tourDriver.drive()
    }, 1200)

    return () => clearTimeout(timeout)
  }, [])

  return null
}

# Astro Launch — X / Twitter Thread

---

## Thread (post each as a separate tweet)

### 1/7 — Hook

We've been building something for the past few months.

Today we're launching Astro — mission control for the AI age.

One goal. Multiple agents. Every machine. From anywhere.

[attach: launch video]

---

### 2/7 — The problem

Right now, AI coding looks like this:

One agent. One chat. One task at a time. You describe what you want, then sit there — waiting, steering, copy-pasting between windows.

The ceiling isn't capability. It's coordination.

---

### 3/7 — What Astro does

Astro is a planning-first platform that sits above your coding agents.

You describe your goal once. Astro decomposes it into a dependency graph — not a flat to-do list — and dispatches tasks to agents running in parallel across your machines.

[attach: screenshot of plan graph view]

---

### 4/7 — The workflow

1. Describe your goal in plain language
2. AI generates a structured plan with dependencies
3. Tasks dispatch to desired compute: local, HPC, or cloud
4. Each task runs in an isolated environment — git worktree with PR, or locally in your folder
5. Approve, steer, or pivot from your browser, phone, or iPad

Export any project as JSON. Load community plans. Share yours back.

Plus an OpenClaw plugin if you want to manage everything from Telegram, Slack, or Discord.

[attach: screenshot of workflow + dashboard on mobile]

---

### 5/7 — Your machines, your keys

Your tasks are run by your own AI agents — Claude Code, Codex, OpenClaw. Astro just orchestrates them smartly and executes in parallel.

Your machines, your keys. Astro never calls AI models directly and never sees your API keys. Every task dispatch is cryptographically signed by your browser. The agent verifies the signature before executing.

---

### 6/7 — 4 ways to use it

1. Plan & execute — describe a goal, AI generates a dependency graph, tasks run in parallel across your machines
2. Custom task graphs — build your own workflows with independent and dependent tasks
3. Built-in templates — stock analysis, paper review, presentation generation, ready to go
4. Playground — single agent sessions on any registered machine, full observability

Walkthroughs for each on the website: astroanywhere.com

[attach: use case screenshots from website]

---

### 7/7 — Open source + quick start

The agent runner is open source:
github.com/astro-anywhere/astro-agent

Quick start:
1. Have Claude Code or Codex ready
2. Create your account at astroanywhere.com
3. npx @astroanywhere/agent
4. Done. Start planning.

Try it now and we look forward to feedbacks! 


## Short blog post (for linking from the thread)

### Astro: Mission Control for the AI Age

AI coding agents are powerful. But right now, using them looks like this: one agent, one chat, one task at a time. You describe what you want, wait, steer, copy-paste between windows, and repeat. The ceiling isn't capability. It's coordination.

**Astro is a planning-first platform that sits above your coding agents.** You describe your goal once. Astro decomposes it into a dependency graph — not a flat to-do list — and dispatches tasks to agents running in parallel across your machines.

#### How it works

1. **Describe your goal** in plain language — "Build a real-time analytics dashboard with auth, Postgres, and deploy to Fly."
2. **AI generates a structured plan** with tasks, dependencies, and milestones. A graph, not a list.
3. **Tasks dispatch to desired compute** — local machines, HPC clusters (Slurm), or cloud VMs. Register once, dispatch forever.
4. **Each task runs in an isolated environment** — its own git worktree with a PR, or locally in your folder.
5. **Approve, steer, or pivot** from your browser, phone, or iPad.

Your tasks are run by your own AI agents — Claude Code, Codex, OpenClaw. Astro just orchestrates them smartly and executes in parallel. Your machines, your keys. Astro never calls AI models directly and never sees your API keys.

Export any project as JSON. Load community plans. Share yours back.

#### Built-in templates

We ship with templates you can try right now:

- **Moat & Fragility Analysis** — enter stock tickers, get a PDF report with competitive advantage scoring, 7 Powers framework assessment, and anti-fragility rating
- **Academic Paper Review** — drop a paper (PDF or arXiv URL), get a structured peer review with scoring rubric, methodology critique, and improvement suggestions
- **Academic Presentation** — paper to conference-ready slides with figures, key results, and speaker notes

Each template runs as a parallel task graph — subtasks execute simultaneously across your machines. Or describe any custom goal and Astro plans it for you.

#### Decide from anywhere

Approve tasks, steer agents, and make strategic decisions from your browser, phone, or iPad. There's also an OpenClaw plugin if you want to manage everything from Telegram, Slack, or Discord.

#### Security

Every task dispatch is cryptographically signed by your browser. The agent runner verifies the signature before executing. The agent runner is open source — you can audit exactly what runs on your machine.

#### Quick start

1. Have Claude Code or Codex ready on your machine
2. Create your account at [astroanywhere.com](https://astroanywhere.com)
3. Run `npx @astroanywhere/agent` — it detects your AI providers, authenticates via your browser, and connects
4. Open Mission Control and start planning

Agent runner: [github.com/astro-anywhere/astro-agent](https://github.com/astro-anywhere/astro-agent)

Try it now and we look forward to feedback!

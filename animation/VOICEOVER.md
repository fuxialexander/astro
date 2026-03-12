# Astro Launch Animation — Voiceover Guide

## Scene Overview & Timing

| Scene | Label | Duration | What's on screen |
|-------|-------|----------|------------------|
| 0 | Tension | ~8s | "One agent. One chat. One task at a time." then "There's a better way." |
| 1 | ASTRO Reveal | ~10s | Wordmark + tagline + 4 highlight pills |
| 2 | Describe | ~10s | Chat panel: user types goal, AI generates plan |
| 3 | Plan | ~10s | DAG graph: milestones, 3 parallel tasks, status changes |
| 4 | Execute | ~10s | Activity feed: streaming events, tool calls, file changes, timer/cost |
| 5 | Observe | ~8s | Timeline with progress bars, today line |
| 6 | Close | ~8s | Wordmark, tagline, npx command, URLs |

---

## Part 1: Main Idea of Each Scene

**Scene 0 — Tension.** Set the problem. The audience feels the frustration of the current AI coding workflow: one agent, one chat window, one task at a time. You're stuck babysitting. Then the turn: there's a better way.

**Scene 1 — ASTRO Reveal.** Brand moment. Show Astro's identity and four pillars: describe once (no iterative chatting), multiple agents on any machine (universal control plane), browser and mobile access (phone, iPad), and OpenClaw plugin support (approve and steer via Telegram, Slack, Discord).

**Scene 2 — Describe.** The first step of the workflow. User types a single natural-language goal. Astro's AI generates a structured plan — not a flat list, but a DAG with dependencies and milestones. No back-and-forth chat loop.

**Scene 3 — Plan.** Show the plan graph. Three tasks run in parallel (Auth & database, API endpoints, Dashboard UI). Dependencies converge at milestones. Tasks light up as they execute and turn green on completion. The parallel layer is the key visual.

**Scene 4 — Execute.** Zoom into one task. The activity feed streams in real time: tool calls, file changes, code diffs. Timer ticks, cost accumulates. The agent works autonomously — you watch or walk away.

**Scene 5 — Observe.** Pull back to the dashboard view. A timeline shows all tasks across the project. See what's done, what's running, what's planned. One view for everything.

**Scene 6 — Close.** Brand outro. Astro wordmark, tagline, install command, website, and GitHub repo.

---

## Part 2: Verbatim Voiceover Scripts

Copy each block exactly. Read at a natural, measured pace (~140 words/min).

### Scene 0 (Tension)

> One agent. One chat. One task at a time. You describe what you want, and then you sit there — waiting, steering, copy-pasting between windows. The ceiling isn't capability. It's coordination. There's a better way.

### Scene 1 (ASTRO Reveal)

> Astro. Mission control for the AI age. Describe your goal once — no iterative chatting. Run multiple agents on any machine from a single control plane. Access it from your browser, your phone, or your iPad. And as an OpenClaw plugin, approve and steer from Telegram, Slack, or Discord.

### Scene 2 (Describe)

> You start with a goal. "Build a real-time analytics dashboard with auth, Postgres, and deploy to Fly." Astro's AI breaks this down into a structured plan — tasks, dependencies, milestones. Not a flat to-do list. A graph.

### Scene 3 (Plan)

> The plan is a directed graph. Tasks that can run in parallel do. Here, three tasks execute simultaneously — auth, API, and UI. When they converge, the next phase begins. Dependencies are explicit. Nothing runs before it's ready.

### Scene 4 (Execute)

> Now watch a task run. The activity feed streams in real time. Tool calls, file changes, code diffs — everything is visible. The timer ticks, cost accumulates. The agent works autonomously. You watch, or you walk away.

### Scene 5 (Observe)

> One timeline. All tasks. You see what's completed, what's running, and what's still planned. No switching between terminals. No guessing. One dashboard for the entire project.

### Scene 6 (Close)

> Astro. Mission control for the AI age. Try it now.

---

## Part 3: Production Plan

### Step 1 — Record per-scene audio files

For each scene, record the voiceover separately:

```
scene-0-tension.mp3
scene-1-reveal.mp3
scene-2-describe.mp3
scene-3-plan.mp3
scene-4-execute.mp3
scene-5-observe.mp3
scene-6-close.mp3
```

Use any recording app (Voice Memos, Audacity, etc.). Read at ~140 wpm. Leave 0.5s silence at the start and end of each clip.

### Step 2 — Screen-capture each scene independently

Open `animation/index.html` in Chrome full-screen. For each scene:

1. Click the nav dot to jump to that scene
2. Click **Replay** to restart the scene animation
3. Start screen recording (QuickTime or OBS) right before clicking Replay
4. Let the animation play through
5. Stop recording

This gives you 7 separate video clips:

```
scene-0.mov  scene-1.mov  ...  scene-6.mov
```

### Step 3 — Sync audio to video per scene

In any video editor (iMovie, DaVinci Resolve, CapCut, or FFmpeg):

1. Import scene video + matching audio
2. Align the audio start to when the first visual element appears
3. Trim the video to match audio duration (or vice versa)
4. Export each scene as a clip

### Step 4 — Adjust timing if needed

If the voiceover is longer or shorter than the animation:

- **Voiceover too long**: In `index.html`, increase `SCENE_DURATION` (currently 12000ms) or add delays in the GSAP timeline for that scene (increase the `+=` values in `buildSceneN()`)
- **Voiceover too short**: Reduce the `+=` delay values in the corresponding `buildSceneN()` function
- Re-capture only that single scene. The other scenes don't change.

### Step 5 — Assemble final video

Concatenate all 7 clips in order:

```bash
# Create a file list
for i in 0 1 2 3 4 5 6; do echo "file 'scene-$i.mp4'" >> list.txt; done

# Concatenate with FFmpeg
ffmpeg -f concat -safe 0 -i list.txt -c copy astro-launch.mp4
```

Or drag all 7 clips into a timeline in iMovie / DaVinci Resolve.

### Step 6 — Add background music (optional)

Layer a subtle ambient track at -20dB under the voiceover. Fade in at Scene 0, fade out at Scene 6.

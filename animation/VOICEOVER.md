# Astro Launch Animation — Voiceover Guide

## Scene Overview & Timing

| Scene | Label | Duration | What's on screen |
|-------|-------|----------|------------------|
| 0 | Tension | ~10s | "One agent. One chat. One task at a time." then "There's a better way." |
| 1 | ASTRO Reveal | ~12s | Wordmark + tagline + 4 highlight pills |
| 2 | Describe | ~14s | Chat panel: user types goal, AI generates plan |
| 3 | Plan | ~14s | DAG graph: milestones, 3 parallel tasks, status changes |
| 4 | Execute | ~16s | Activity feed: streaming events, tool calls, file changes, timer/cost |
| 5 | Observe | ~10s | Timeline with progress bars, today line |
| 6 | Close | ~8s | Wordmark, tagline, npx command, URLs |

**Total: ~84s (~1:24)**

---

## Part 1: Main Idea of Each Scene

**Scene 0 — Tension.** Set the problem. The audience feels the frustration of the current AI coding workflow: one agent, one chat window, one task at a time. You're stuck babysitting. Then the turn: there's a better way.

**Scene 1 — ASTRO Reveal.** Brand moment. Show Astro's identity and core pillars: describe once, multiple agents on any machine, and approve/steer from anywhere (browser, phone, Telegram).

**Scene 2 — Describe.** The first step of the workflow. User types a single natural-language goal. Astro's AI generates a structured plan — not a flat list, but a DAG with dependencies and milestones. No back-and-forth chat loop.

**Scene 3 — Plan.** Show the plan graph. Three tasks run in parallel (Auth & database, API endpoints, Dashboard UI). Dependencies converge at milestones. Tasks light up as they execute and turn green on completion. The parallel layer is the key visual.

**Scene 4 — Execute.** Zoom into one task. The activity feed streams in real time: tool calls, file changes, code diffs. Timer ticks, cost accumulates. The agent works autonomously — you watch or walk away.

**Scene 5 — Observe.** Pull back to the dashboard view. A timeline shows all tasks across the project. See what's done, what's running, what's planned. One view for everything.

**Scene 6 — Close.** Brand outro. Astro wordmark, tagline, install command, website, and GitHub repo.

---

## Part 2: Verbatim Voiceover Scripts

Copy each block exactly. Read at a natural, measured pace (~140 words/min).

### Scene 0 (Tension) — ~10s, 27 words

> One agent. One chat. One task at a time. You're stuck — waiting, steering, copy-pasting. The ceiling isn't capability. It's coordination. There's a better way.

### Scene 1 (ASTRO Reveal) — ~12s, 27 words

> Astro. Mission control for the AI age. Describe your goal once. Run multiple agents on any machine. Approve and steer from anywhere — browser, phone, or Telegram.

### Scene 2 (Describe) — ~14s, 22 words

> Start with a goal. Astro's AI breaks it into a structured plan — tasks, dependencies, milestones. Not a to-do list. A graph.

### Scene 3 (Plan) — ~14s, 23 words

> The plan is a directed graph. Tasks that can run in parallel do. When they converge, the next phase begins. Dependencies are explicit.

### Scene 4 (Execute) — ~16s, 28 words

> Watch a task run. The activity feed streams in real time — tool calls, file changes, code diffs. The agent works autonomously. You watch, or you walk away.

### Scene 5 (Observe) — ~10s, 18 words

> One timeline. All tasks. See what's done, what's running, what's planned. No switching between terminals. One dashboard for everything.

### Scene 6 (Close) — ~8s, 10 words

> Astro. Mission control for the AI age. Try it now.

---

## Part 3: Production Plan

### Step 1 — Generate per-scene audio with TTS

Use MegaTTS3 for final quality (or Kokoro for rapid iteration):

```
scene-0-tension.mp3
scene-1-reveal.mp3
scene-2-describe.mp3
scene-3-plan.mp3
scene-4-execute.mp3
scene-5-observe.mp3
scene-6-close.mp3
```

**Tips for TTS generation:**
- Use a calm, confident male/female voice reference — avoid overly enthusiastic delivery
- Add 0.5s silence at the start and end of each clip
- For Scene 0, ensure clear pauses between "One agent." / "One chat." / "One task at a time." — these are dramatic beats
- For Scene 6, slow the pace slightly for gravitas

### Step 2 — Adjust animation timing to match audio

After generating audio, measure each clip's duration and update `SCENE_DURATIONS` in `animation/index.html`:

```javascript
// Update these values to match your actual audio durations (in ms)
const SCENE_DURATIONS = [10000, 12000, 14000, 14000, 16000, 10000, 8000];
```

If a scene's audio is longer than its animation:
- Increase the corresponding `SCENE_DURATIONS` value
- Add delays in the GSAP timeline for that scene (increase `+=` values in `buildSceneN()`)

If shorter:
- Reduce the `+=` delay values in the corresponding `buildSceneN()` function

### Step 3 — Screen-capture each scene independently

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

### Step 4 — Sync audio to video per scene

In any video editor (iMovie, DaVinci Resolve, CapCut, or FFmpeg):

1. Import scene video + matching audio
2. Align the audio start to when the first visual element appears
3. Trim the video to match audio duration (or vice versa)
4. Export each scene as a clip

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

Layer a subtle ambient/electronic track at -18dB under the voiceover. Fade in at Scene 0, fade out at Scene 6.

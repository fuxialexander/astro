# Astro Launch — Xiaohongshu

---

## Title options (pick one)

A: 做了几个月，发布一个 AI 协调平台：Astro
B: AI coding 不应该是一个 agent 一个窗口 — 发布 Astro
C: 开源发布：Astro — AI 时代的 Mission Control

---

## Post body

现在的 AI coding 工作流有一个核心问题：

一个 agent，一个聊天窗口，一次只能做一件事。你描述需求，然后坐在那等，引导，复制粘贴上下文。能力不是瓶颈，协调才是。

我们做了 Astro 来解决这个问题。

### Astro 是什么

一个 planning-first 的平台，坐在你的 coding agent（Claude Code、Codex 等）之上。

核心流程：
1. 用自然语言描述目标（比如："做一个带认证和数据库的实时 dashboard，部署到 Fly"）
2. AI 自动生成结构化的依赖图 — 不是 flat list，是 DAG
3. 能并行的任务自动并行 dispatch 到你的机器
4. 每个任务在独立 git worktree 执行，结果以 PR 形式返回
5. 你只需要做战略决策：继续还是调整方向？

### 核心特性

- 多环境执行：本地 / HPC (Slurm) / 云端，注册一次，永久 dispatch
- 随时随地决策：作为 OpenClaw 插件，通过 Telegram / Slack / Discord 审批和管理
- 浏览器、手机、iPad 都能访问 dashboard
- 安全：你的机器，你的 API key。Astro 服务器不调用 AI 模型，不接触你的密钥。每次 dispatch 都有浏览器端的加密签名

### 适合谁

程序员 — 用 AI agent 做开发，需要在代码之上有产品级别的规划。并行 ship 功能，PR 之间能 hang together

科研人员 — 管理跨计算环境（笔记本、HPC 集群、云 GPU）的分支分析。看到完整的探索树，裁剪无效分支

### Quick Start

1. 机器上有 Claude Code 或 Codex
2. 去 astroanywhere.com 注册
3. 终端跑 `npx @astroanywhere/agent`
4. 它会自动检测你的 AI 工具、认证、连接
5. 打开 Mission Control 开始 planning

Agent runner 开源：github.com/astro-anywhere/astro-agent
网站：astroanywhere.com

---

Apollo missions aren't run from chat windows.

---

## Suggested images (4-6 images for Xiaohongshu carousel)

1. Launch video 封面截图（ASTRO wordmark + tagline）
2. Plan graph 截图（DAG 视图，展示并行任务）
3. Landing page "How It Works" 截图
4. Use cases section 截图（Builder / Scientist personas）
5. Activity feed 截图（实时 streaming 执行）
6. Landing page "Run Anywhere" 截图（多环境 dispatch）

---

## Tags

#AIcoding #开源 #开发者工具 #Astro #CodingAgent #ClaudeCode #Codex #DevTools #程序员 #科研工具 #MissionControl

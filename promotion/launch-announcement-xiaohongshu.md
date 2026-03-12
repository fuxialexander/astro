# Astro Launch — Xiaohongshu

---

## Title options (pick one)

A: 搞了几个月，发布一个 AI 编排平台：Astro
B: AI coding 不该是一个 agent 一个窗口 — 发布 Astro
C: 开源发布：Astro — AI 时代的 Mission Control

---

## Post body

现在的 AI coding 工作流有一个核心问题：

一个 agent，一个聊天窗口，一次只能做一件事。你描述需求，然后坐在那等，引导，复制粘贴上下文。能力不是瓶颈，协调才是。

我们做了 Astro 来解决这个问题。

### Astro 是什么

一个 planning-first 的平台，坐在你的 coding agent（Claude Code、Codex 等）之上。

核心流程：
1. 用自然语言描述目标
2. AI 自动生成结构化的依赖图 — 不是 flat list，是 DAG
3. 任务 dispatch 到你想要的计算环境：本地、HPC、云端
4. 每个任务在隔离环境中执行 — git worktree + PR 或本地文件夹
5. 浏览器、手机、iPad 随时审批、引导、调整方向

你的任务由你自己的 AI agent 执行 — Claude Code、Codex、OpenClaw。Astro 只做编排和并行调度。你的机器，你的密钥，服务器不碰。

项目可导出 JSON，可加载社区模板，可分享。另有 OpenClaw 插件支持 Telegram / Slack / Discord。

### 4 种使用方式

1. Plan & Execute — 描述目标，AI 生成依赖图，并行执行
2. Custom Task Graphs — 自建任务图，独立/依赖任务随意组合
3. Built-in Templates — 股票分析、论文审稿、论文演示，开箱即用
4. Playground — 单个 agent session，任意机器，完整可观测性

### Quick Start

1. 机器上有 Claude Code 或 Codex
2. 去 astroanywhere.com 注册
3. 终端跑 `npx @astroanywhere/agent`
4. 自动检测 AI 工具、认证、连接
5. 打开 Mission Control 开始 planning

Agent runner 开源：github.com/astro-anywhere/astro-agent
网站：astroanywhere.com

Twitter 发布帖在这里，欢迎帮忙转发点赞：
x.com/0astroanywhere0/status/2032157710213603592

欢迎试用，期待反馈！

---

## Suggested images (4-6 images for carousel)

1. Launch video 封面截图（ASTRO wordmark + tagline）
2. Architecture 图（3 层架构）
3. DAG 工作流图（并行任务）
4. Usage examples 图（内置模板）
5. Plan & execute 工作流图
6. GitHub workflow 图（worktree -> PR）

---

## Tags

#AIcoding #开源 #开发者工具 #Astro #CodingAgent #ClaudeCode #Codex #DevTools #程序员 #科研工具 #MissionControl

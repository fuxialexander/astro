# Astro Launch — WeChat Moments

---

## Version A (detailed)

搞了几个月，今天正式发布 Astro — AI 时代的 Mission Control。

现在用 AI coding agent 的体验是：一个 agent，一个聊天窗口，一次做一件事。你描述需求，然后坐在那儿等、引导、在窗口之间复制粘贴。瓶颈不是 AI 的能力，是协调。

Astro 是一个 planning-first 的平台，坐在 coding agent 之上：

- 描述一次目标，AI 自动生成依赖关系图（不是平铺的 to-do list）
- 任务 dispatch 到你想要的计算环境：本地、HPC 集群、云端
- 每个任务在隔离环境中执行——独立 git worktree + PR，或者本地文件夹
- 浏览器、手机、iPad 随时审批和决策
- 项目可导出 JSON，可加载社区模板，可分享

你的任务由你自己的 AI agent 执行——Claude Code、Codex、OpenClaw。Astro 只做编排和并行调度。你的机器，你的 API key，服务器不碰模型也不碰密钥。

4 种使用方式：
1. Plan & Execute — 描述目标，AI 生成依赖图，并行执行
2. Custom Task Graphs — 自建任务图，独立/依赖任务随意组合
3. Built-in Templates — 股票分析、论文审稿、论文演示，开箱即用
4. Playground — 单个 agent session，任意机器，完整可观测性

Quick start：
1. 准备好 Claude Code 或 Codex
2. astroanywhere.com 注册
3. npx @astroanywhere/agent
4. 开始 planning

Agent runner 开源：github.com/astro-anywhere/astro-agent
网站：astroanywhere.com

Twitter 发布帖在这里，欢迎帮忙转发点赞：
x.com/0astroanywhere0/status/2032157710213603592

欢迎试用，期待反馈！

[配图：launch video 截图 / architecture 图 / DAG 工作流图]

---

## Version B (shorter)

发布了一个新项目：Astro — AI 时代的 Mission Control。

描述一次目标，AI 生成依赖图，你自己的 agent（Claude Code / Codex / OpenClaw）在多台机器上并行执行。你的机器，你的密钥，服务器不碰。

4 种用法：Plan & Execute / Custom Task Graphs / Built-in Templates / Playground

Agent runner 开源：github.com/astro-anywhere/astro-agent
网站：astroanywhere.com

Twitter thread 欢迎转发：x.com/0astroanywhere0/status/2032157710213603592

[配图]

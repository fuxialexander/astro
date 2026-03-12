# Astro Launch — WeChat Moments

---

## Version A (concise, with visual)

搞了几个月，今天正式发布 Astro — AI 时代的 Mission Control。

现在用 AI coding agent 的体验是：一个 agent，一个聊天窗口，一次做一件事。你描述需求，然后坐在那儿等、引导、在窗口之间复制粘贴。瓶颈不是 AI 的能力，是协调。

Astro 是一个 planning-first 的平台，坐在 coding agent 之上：

- 你描述一次目标，AI 自动生成依赖关系图（不是平铺的 to-do list）
- 能并行的任务自动并行，dispatch 到你的本地、HPC 集群、云端
- 每个任务在独立的 git worktree 里跑，结果以 PR 形式返回
- 通过 Telegram / Slack / Discord 随时审批和决策（OpenClaw 插件）
- 你的机器，你的 API key，服务器不碰模型也不碰密钥

适合谁：
- 程序员：并行 ship 产品级功能，不只是单个文件
- 科研人员：管理跨环境（笔记本/HPC/云）的分支式分析流程

Quick start：
1. 准备好 Claude Code 或 Codex
2. astroanywhere.com 注册
3. npx @astroanywhere/agent
4. 开始 planning

Agent runner 开源：github.com/astro-anywhere/astro-agent

Apollo missions aren't run from chat windows.

[配图：launch video 截图 / plan graph 截图 / landing page 截图]

---

## Version B (shorter, punchier — if you prefer brevity)

发布了一个新项目：Astro — AI 时代的 Mission Control。

一句话描述目标，AI 生成依赖图，多个 agent 在多台机器上并行执行，通过 Telegram/Slack 随时审批。你的机器，你的密钥，服务器不碰。

给程序员用：并行 ship 功能，结果以 PR 返回。
给科研用：跨 HPC/云/本地管理分支分析。

Agent runner 开源：github.com/astro-anywhere/astro-agent
网站：astroanywhere.com

[配图]

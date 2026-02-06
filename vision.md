





Product Vision
—
Planning-First Development and Exploration for the Age of AI Agents
DRAFT — February 2026
Confidential
 
1. The Thesis
The era of agent calls is also an era for builders and scientists. They are two groups of people consistently challenged by long horizon planning problems, and they are running into the same wall right now. Builders use coding agents to ship features, but they’re stuck in a one-at-a-time chat loop with product plan manually injected into CLAUDE.md. Each agent session work on it’s own island with little coordination for related features. While scientists use computational tools to chase hypotheses, but they’re juggling branching analyses across personal laptops, HPC clusters with private data, and cloud machines with nothing tying it all together—no way to see which branches look promising, which are dead ends, or how to spend limited time wisely.
Both groups need the same thing: a planning layer that sits above their execution tools. Something that helps them break down complex goals, manage dependencies, send work to agents across different environments, and focus their own attention on the decisions that actually require a human brain.
Our thesis has two parts.
First, the planning layer. The missing piece in AI-assisted work isn’t better agents or better code-level context—it’s structured planning above the agents. Coding agents are already good at executing well-defined tasks, and they have solid codebase context. What they can’t do is plan a product, break down a research question, or help you strategically decide where to spend your time when you’re pulled in five directions. That’s what we’re building.
Second, the data flywheel. Planning isn’t a static problem. Every builder and scientist who uses the platform creates structured planning data: how they decompose goals, where they override AI suggestions, which branches they kill and why, what architectural and analytical calls they make. This data—captured naturally through issue titles, project descriptions, plan structures, and correction patterns—becomes real-time context that makes planning better for everyone who comes after. This is especially crucial for science which happens in the boundary of human knowledge and viral apps that fly with ever changing human tastes and needs.
At launch, the LLM’s existing knowledge is the domain expert. It generates plans from training data, and that’s already genuinely useful—the LLM knows how experienced engineers structure products and how seasoned researchers design experiments. But over time, we mix generic LLM knowledge with population-informed context: real planning patterns from real users, clustered by domain, synthesized by the LLM, and fed back into the planning layer. A computational biologist starting a new evo-devo analysis in lobster doesn’t get a cookie-cutter plan—they get one shaped by how dozens or hundreds of other computational biologists and developmental biologist approached similar work recently, what succeeded, and what they had to fix.
This is the next generation of context engineering: assembling better information into the planning prompt over time, drawn from the collective experience of everyone on the platform, in real time before the pretraining data get updated 6 months later. The product gets smarter with every user, not by retraining the model, but by feeding it richer, more specific context. That creates a compounding advantage no competitor can match without the same planning data—which only exists inside our platform.
 
2. The Problem
2.1 For Builders: One Thing at a Time, No Big Picture
Here’s what building with coding agents looks like today: describe a feature in a chat, wait for the PR, review it, go back to the chat, describe the next feature. Rinse and repeat. This breaks down on anything real because there’s no plan. Each agent session is architecturally isolated—not at the code level (agents can read the codebase just fine), but at the product level. The agent working on feature 7 understands the code it’s touching, but it has zero awareness of your product vision, your UX strategy, or how feature 7 is supposed to play with features 3 and 12.
The result: features that work individually but don’t hang together as a product. And you’re the bottleneck—not because agents are slow, but because you’re manually sequencing, spoon-feeding context, and reviewing one task at a time through a chat window.
2.2 For Scientists: Branching Exploration with No Map
Scientific work doesn’t move in a straight line. It’s tree-shaped: you start with a research question, generate hypotheses, and each hypothesis branches into analysis paths. Within each branch, you might pull in new datasets, try different methods, or look at the data from new angles. Some branches pan out and grow. Others hit walls—the analysis isn’t significant, the supporting dataset doesn’t help the story—and you prune them.
This branching exploration tree is the core intellectual structure of scientific work, but no tool actually represents it. Scientists track their analyses across scattered notebooks, Slurm job logs, local scripts, and what’s in their heads. They can’t see the full tree, can’t easily decide which branch to chase next, and don’t have a clear picture of what downstream work becomes pointless when they kill an upstream branch.
On top of that, scientists work under real deadlines: grant cycles, paper submissions, thesis defenses, conference seasons. Strategic planning—“given four months and three hypotheses, where’s the highest-value place to spend my time?”—happens informally, in the scientist’s head, with no tool helping.
2.3 Same Problem, Different Clothes
Strip away the surface differences, and both workflows share the same planning problem:
Planning Need	Builder Version	Scientist Version
Goal decomposition	Vision → milestones → features → tasks	Question → hypotheses → branches → tasks
Dependencies	Feature B needs feature A’s API	Analysis B needs dataset A’s output
Parallel work	Independent features built at once	Independent analyses run at once
Pruning / pivoting	Feature cut, downstream tasks killed	Hypothesis falsified, branch pruned
Time pressure	Sprint deadlines, MVP scoping	Grant cycles, paper deadlines
Multiple machines	Local + cloud	Laptop + cluster + cloud
Human judgment	Does this match the vision?	Is this result worth pursuing?

The product that serves both populations isn’t two products—it’s one planning layer with a flexible structure that handles both linear pipelines and branching exploration trees.
2.4 What Agents Already Do Well
Let’s be honest about what agents handle already. Modern coding agents like Claude Code have great codebase context—they search files, read CLAUDE.md, and understand project structure, even in isolated worktrees. They knock out short, well-defined tasks quickly and reliably. Code verification is increasingly automated through unit tests, integration tests, and CI. All of this will only get better. We’re not trying to solve code context, execution quality, or code review. We’re solving the planning, decomposition, and strategic decision-making problem that lives above all of that.
 
3. The Product
A planning-first environment for builders and scientists. You describe your goal—a product to build or a research question to explore—and an AI expert generates a structured plan. You refine it. Agents execute tasks from the plan with dependency awareness, across any environment you control. The plan view is the primary interface.
3.1 The Plan Structure
The plan is a directed graph, not a flat list. It handles both linear sequences (feature A → B → C) and branching exploration (hypothesis → branch 1 / branch 2 / branch 3, each with their own sub-tasks and sub-branches). Dependencies are explicit: task B knows it needs task A’s output. Branches can be pruned: mark a branch as a dead end and all downstream tasks are automatically cancelled, with a prompt to redirect your effort elsewhere.
This graph is the core data model. Everything else—the desktop interface, the mobile interface, the agent dispatch system—reads from and writes to it.
3.2 The Core Loop
1.	Describe your goal — a product to build, a research question to explore, a dataset to analyze. Include your background, timeline, and constraints.
2.	AI generates a structured plan — a directed graph of milestones, branches, tasks, and dependencies. The AI acts as a domain expert tailored to your context. For scientists, the plan captures the exploration tree: hypotheses as branches, analyses as tasks, with suggested prioritization given your timeline.
3.	You refine the plan — accept, modify, reorder, add branches, prune branches, override anything. Your expertise and vision shape the final plan.
4.	Tasks dispatch to agents — based on dependency order, across any environment you specify (local, HPC, cloud). Parallel tasks run simultaneously on different machines. Each agent gets its task plus the project’s vision/context document.
5.	Results return to the plan — tasks with automated verification (tests pass, analysis completes, expected output format) can auto-close. Completed tasks update the dependency graph and unblock what comes next.
6.	You make the decisions that matter — not code review, but real judgment calls. For builders: does this feature match the vision? For scientists: does this result justify continuing this line of inquiry, or should I prune it and redirect? The system surfaces these moments; you provide the judgment.
3.3 Tiered Verification: From Code Review to Real Decisions
As agents get better and more outputs become verifiable through automated testing, the human’s role naturally shifts from reviewing code to making strategic and product decisions. The system supports a spectrum:
Auto-close tasks: Tests pass, build succeeds, analysis produces the expected output, pipeline runs clean. The task closes and the plan moves forward without human review. You see a notification, not a review request.
Judgment tasks: Results that need a human eye. For builders: does this feature actually match the product vision? For scientists: is this result meaningful enough to keep going down this branch? Presented as a product preview or result summary—not a code diff.
Strategic decision points: Forks in the plan where you have to choose direction. Which hypothesis gets priority? Which branch to kill? How to reshuffle effort with the time you have left? These are the highest-value decisions and should get the most of your attention.
Over time, as automated verification improves, more tasks auto-close and your attention naturally concentrates on the strategic and judgment calls that only you can make.
3.4 The Desktop/Web Interface
The primary interface is a plan view built for one human directing N agents across M machines.
Plan graph: The full plan visualized as a directed graph or timeline. Branches visible. Dependencies explicit. Tasks color-coded by status: planned, dispatched, in-progress, auto-verified, awaiting judgment, completed, pruned. You see the entire structure at a glance.
Vision/context document: A persistent, editable document describing the product vision or research question, design principles or analytical framework, and key decisions made so far. This gets injected into every agent session—it’s the product-level context that goes beyond what agents pick up from the codebase.
Agent and machine status: Real-time view of what each agent is doing and where it’s running. A scientist sees: agent 1 running alignment analysis on the HPC cluster, agent 2 processing a public dataset on AWS, agent 3 generating figures on the local machine.
Judgment queue: Tasks that passed automated checks but need your call. Shown as product previews (for builders) or result summaries with visualizations (for scientists).
Strategic decision surface: When you hit a branch point, the system surfaces the decision with context: what’s been learned so far, what each branch’s expected effort and timeline look like, and the AI’s recommendation with reasoning.
Git integration: Every task maps to a branch. Auto-verified tasks merge automatically. Judgment tasks merge after you approve.
3.5 The Mobile Interface
Mobile isn’t a shrunken project board—it’s a decision and notification surface. Agents work continuously across multiple machines, producing results and decision points throughout the day. Mobile meets you where you are.
Decision cards: Judgment tasks and strategic decisions show up as lightweight cards. Each one has a summary, the AI’s recommendation with reasoning, and clear actions: approve, modify, reject, defer, or prune branch. For builders: “Does this navigation feel right? Here’s a preview.” For scientists: “This analysis came back with a p-value of 0.03. Keep going with this branch or pivot to hypothesis B?”
Notification center: Real-time updates when tasks auto-close (giving you a sense of progress), when errors pop up, when branches get unblocked, or when strategic decisions need your attention. Every notification is something you can act on.
Progress pulse: A quick summary of where things stand. How many tasks finished today? Which branches are active? What’s the next decision coming? Stay informed without opening the full desktop view.
Progressive disclosure: Cards show a summary and preview. Tap to expand for full results, agent logs, or deeper context. Most decisions take seconds because they’re judgment calls (“does this look right?” or “should I keep going here?”), not line-by-line code review.
 
4. Differentiation
Linear + Cyrus gives you a project board where you assign issues to agents and get PRs back. That’s the closest thing out there. Here’s what makes us different:
4.1 AI-Generated Plans with Graph Structure
In every existing tool, you create the plan from scratch—writing every issue, defining every milestone. In our product, the AI generates a structured plan from a goal description. And the plan is a graph, not a flat list: it supports branching, dependencies, and pruning. No project management tool today represents an exploration tree where branches can be expanded, pruned, or re-prioritized as results come in.
4.2 Dependency-Aware Parallel Execution Across Environments
We maintain an explicit dependency graph and automatically dispatch tasks when prerequisites are met—across any environment you control. A scientist can have one agent on their laptop, another on an HPC cluster via Slurm, and a third on AWS, all visible from one interface. Cyrus is one agent, one machine. We’re N agents across M machines, coordinated by dependencies.
4.3 Branch Pruning and Effort Reallocation
When you prune a branch (hypothesis falsified, analysis inconclusive), all downstream tasks are automatically cancelled and the system nudges you to redirect effort. This doesn’t exist in Linear or any traditional project management tool. It’s a first-class operation in our plan graph.
4.4 Product/Research Vision Coherence
Separate from codebase context (which agents already have), we maintain a persistent vision document—describing the product’s purpose or the research question’s analytical framework—that gets injected into every agent session. This is the context layer above the code.
4.5 Tiered Verification
Not every task needs your eyes. Auto-verifiable tasks close on their own. Your attention goes to judgment calls and strategic decisions. This gets more powerful over time as automated verification improves.
4.6 Mobile Decision Interface
A decision surface built for quick judgment calls. Lightweight cards for product and research decisions, not issue threads for code review.
4.7 Time-Constrained Strategic Planning
The system helps you plan across a timeline: given remaining time and competing goals or branches, what’s the best use of your effort? No tool today combines project planning with time-horizon strategy for individual builders or scientists.
 
5. The Planning Expertise System
5.1 At Launch: The LLM as Domain Expert
The AI planning layer uses the LLM’s existing knowledge as the domain expert. When you describe your product goal or research question, the system constructs an appropriate expert persona. A computational biologist gets plans informed by bioinformatics best practices. A frontend developer gets plans shaped by modern web architecture. The LLM already has expert-level knowledge for most domains; our job is to draw it out through well-structured prompting and present it as a usable, editable plan.
5.2 Over Time: Learning from the Crowd
This is the second half of the thesis. Every time someone refines a plan—reorders tasks, changes architecture, adds dependencies, overrides a suggestion, prunes a branch—that’s a structured signal about how real experts tackle real problems. The system collects these signals and uses them through context engineering: planning prompts evolve to include patterns from actual users in real time.
When people identify their domain (computational biology, web development, data engineering, etc.), their planning data joins a domain-specific pool. Embeddings or LLM-based clustering groups users solving similar problems. Expert patterns—captured naturally in how they titled issues, structured plans, chose architectures, and corrected AI suggestions—get synthesized and fed as context to the planning layer for less experienced users.
This works without collaborative filtering, without massive scale, and without retraining models. It’s structured information assembled into better prompts over time. The product gets smarter with every user—not because the model changes, but because the context it receives improves. That’s the compounding advantage: a data flywheel that only exists inside our platform and that no one can replicate without the same usage data.
5.3 The Data Asset
The structured planning traces—human intent, AI-generated plans, expert corrections, branch pruning decisions, execution outcomes—are uniquely valuable training data for future models that need to get better at long-horizon planning. That’s the exact capability gap limiting AI agents on complex projects today. For the scientific population specifically, the exploration tree data (which hypotheses were pursued, which were pruned, which branches led to publishable results) is an entirely novel signal that doesn’t exist in any current dataset.
Data Signal	Where It Comes From	Why It Matters
Goal decomposition	How users break goals into structured plans with branches and dependencies	Teaches long-horizon planning to future models
Expert overrides	Where experienced users change AI-generated plans	Shows where AI planning falls short
Pruning decisions	Which branches were abandoned and why	Teaches strategic resource allocation under uncertainty
Execution outcomes	Which plan structures led to successful completion	Links planning decisions to real-world results

6. The Execution Layer
The execution layer wraps existing agents. As agents improve from any provider, our platform improves automatically. We compete on planning and orchestration, not execution.
Agent-agnostic: We support multiple coding and analysis agents. The system wraps any agent that can take a task description and produce output.
Multi-environment dispatch: Agents run on local machines, HPC clusters (Slurm), cloud instances (AWS, GCP), or research infrastructure. You see everything from one interface. A scientist assigns analysis tasks to their cluster and figure generation to their laptop from the same plan view.
Vision/context injection: Every agent session gets its task description plus the project’s vision/context document. This provides the product-level or research-level context that goes beyond what the agent picks up from the codebase.
Tiered verification: Auto-close for verifiable tasks. Your judgment for everything else. The ratio shifts toward auto-close over time as verification gets better.
7. Collaboration Model
We start with 1 user → N agents → M machines. You’re the planner and decision-maker. The agents are the workforce. The machines are the infrastructure.
The most natural next step is the team model for research labs: a PI creates the exploration plan, lab members contribute to branches, agents execute across the lab’s shared infrastructure, and the system keeps track of who’s doing what. But the single-user experience has to be excellent first.
8. Why Now
Agents execute well but can’t plan. The gap is decomposition, not execution. Agents have codebase context and produce reliable outputs. They can’t break down a product vision or a research question into a coherent plan.
The human bottleneck is strategic, not technical. Agents are fast. Code review is increasingly automatable. The real bottleneck is human decisions: what to build next, which branch to pursue, when to cut your losses. A planning-first environment puts attention where it matters.
Scientists are already doing multi-environment orchestration—just badly. Researchers running analyses on HPC clusters, cloud instances, and local machines are already coordinating agents across environments. They’re just doing it manually, through Slurm scripts and SSH sessions. They need a planning layer above this, not a new execution engine.
Multi-agent orchestration will be commoditized. The plumbing of agent coordination will become a solved problem. What stays valuable is helping humans plan, explore strategically, and make decisions. That’s us.
Planning data is the durable moat, and it only comes from usage. The data that makes planning better—how real builders decompose products, how real scientists structure exploration trees, where they override AI suggestions, which plans actually work—can only come from a platform people actually use for planning. Every user makes planning better for every future user, through context engineering rather than model retraining. The earlier we start, the wider the gap.
9. Product Scope
Core
•	AI-generated plans with graph structure — supporting both linear pipelines and branching exploration trees
•	Dependency-aware parallel dispatch across any environment (local, HPC, cloud)
•	Branch pruning with automatic downstream cancellation and effort reallocation prompts
•	Persistent vision/context document injected into every agent session
•	Tiered verification — auto-close for verifiable tasks, human judgment for the rest
•	Desktop plan view with graph visualization, agent/machine status, and judgment queue
•	Mobile decision interface for lightweight judgment calls, strategic decisions, and notifications
•	Agent-agnostic execution wrapper supporting multiple agents
•	Planning expertise system — LLM expert at launch, improving with real usage data over time via context engineering
Future Extensions
•	Team collaboration (PI + lab model, shared plans, role-based access)
•	Expert knowledge marketplace — curated planning templates by domain
•	Cross-source synthesis (GitHub, Slurm logs, calendar, third-party data)
•	Planning data pipeline for model training partnerships
•	Time-horizon optimizer — given deadlines and branch priorities, recommend effort allocation strategy
10. Mission
Give every builder and scientist a planning layer that matches the power of their execution tools — so that one person with a vision can ship what previously required a team, and one researcher with a question can explore what previously required a lab.


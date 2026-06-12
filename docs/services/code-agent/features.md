# Code Agent

The autonomous coding service inside IntexuraOS — describe what you want, walk away, and come back to a pull request (a finished code change, ready for someone to review and approve).

## The Problem

You know exactly what needs to change. The signup page shows a generic error when someone tries to register with an existing email. The dashboard needs date filtering. A piece of the system quietly ignores errors instead of reporting them. You could describe any of these fixes in thirty seconds. Building them takes hours — sometimes days, if the backlog is long and the engineer is busy.

AI coding tools promise to close that gap, but most of them skip the part that matters. You type a prompt, and minutes later a pull request appears, built on assumptions you never approved. Maybe it rewrote the wrong file. Maybe it chose an architecture that conflicts with the rest of your system. You discover this during code review, after the compute is spent and the time is gone. You have spent your morning reviewing a change you cannot merge. Now you are debugging AI output instead of shipping.

The deeper problem was never getting a machine to write code. It was getting a machine to write the *right* code — and proving, before you merge it, that the result actually works.

## Use Case: From Voice Note to Pull Request

You run a SaaS product and your morning is already full. This is what happens when an idea hits you between meetings.

1. You are driving when you notice the onboarding flow sends a confusing error message. You record a WhatsApp voice note: "Fix the signup error — when someone uses an email that already exists, tell them the account exists instead of showing a generic failure."

2. By the time you park, your voice note has been transcribed and turned into a code task. A project issue appears in Linear — your team's project tracker — with a clear title and description.

3. The agent produces a design: which file handles the signup flow, what the new error message should say, which tests need updating, and how it plans to verify the fix. Then it stops and waits for you.

4. Over coffee the next morning, you open the dashboard and read the design. It looks right. You tap approve.

5. The agent picks up the task on your own machine, writes the code inside an isolated environment, runs the test suite, and opens a pull request. A WhatsApp notification arrives with a button linking straight to the PR.

6. Your co-founder reviews the PR and leaves a comment: "Can we also handle the case where the email has different capitalization?" The agent detects the comment, picks up the feedback with full context of the original work, and pushes an update. You never opened a code editor.

## How It Helps

### Execution Memory Graph — The Agent Learns From Its Work

Every task the agent completes feeds a learning loop. After a run finishes, an independent evaluator reads the execution logs, extracts reusable lessons — implementation patterns, verification strategies, pitfalls to avoid — and stores them as structured memories with vector embeddings. The next time a similar task arrives, the system retrieves the most relevant memories and injects them into the agent's context before it starts writing code.

The pipeline runs in three stages: data collection (capturing structured evidence from completed tasks), distillation (an LLM extracts actionable memories from the evidence), and retrieval (vector search surfaces the most relevant memories for the current task). Each memory carries a quality score, application count, and positive/negative feedback — so memories that prove useful rise to the top, and those that mislead get suppressed.

This is an alpha capability focused on data collection and RAG pipeline tuning. The memory types include implementation patterns, verification patterns, pitfall patterns, decomposition patterns, planning decisions, and review findings — each stored with component hints, keywords, and confidence scores.

**Example:** The agent built a pagination feature last week and discovered that the repository's Firestore queries require composite indexes for multi-field sorting. This lesson was distilled into a pitfall pattern. When a new task arrives to add filtering to another endpoint, the agent retrieves the memory and includes the composite index requirement in its plan — avoiding the CI failure that happened the first time.

### Remediation Agent — Autonomous Auto-Improvement Loop

When the review agent finds issues in a pull request, the system can autonomously create a follow-up remediation task to fix the findings. The remediation agent reads the review feedback, pushes fixes to the same PR branch, and the review cycle restarts. This creates an event-sourced improvement loop: review, fix, re-review — running without human intervention until the PR is clean.

The remediation pipeline uses cross-LLM verification: Claude writes the code, Gemini evaluates whether the review findings were addressed. The decision to remediate is recorded in the PR automation log with full audit trail — you can see exactly which findings triggered remediation, what the agent changed, and whether the re-review passed.

The loop enforces guardrails: remediation tasks can only address findings from the preceding review, the agent cannot expand scope beyond the review feedback, and all changes push to the existing PR branch rather than creating new PRs. If the remediation fails or the re-review still finds issues, the system escalates to the dashboard for human attention.

**Example:** The review agent posts three findings on a PR: a missing null check, an unused import, and an inconsistent error message. The system creates a remediation task that addresses all three. After fixing the code, a fresh review confirms the findings are resolved and sets the `ready-to-merge` label on the Linear issue — all without you opening the PR.

### Ask Agent — Interactive Claude Code Sessions

Open a conversation with Claude Code directly from the web dashboard. Unlike regular code tasks that follow a design-then-build workflow, Ask Agent sessions are interactive, back-and-forth conversations for exploring ideas, debugging issues, or asking questions about your codebase.

Sessions use the Opus model and run on your configured workers, inheriting the same security and infrastructure controls as regular code tasks. The conversation persists across devices — start a session on your desktop, continue it from your phone.

**Example:** You are reviewing a PR and want to understand the implications of a type change. You open an Ask Agent session, paste the type definition, and ask "What callers would break if I change this field from optional to required?" The agent searches the codebase on your machine and gives you a concrete list of affected files with the exact lines that need updating.

### Queue and Auto-Merge Pull Requests

When multiple bot-authored PRs target the same branch, merging them one-by-one invites conflicts. The merge queue watches a base branch, checks each PR's CI status and mergeability, and merges the oldest eligible PR automatically on every tick — driven by Cloud Scheduler. You create a watch from the dashboard, and the system drains PRs in order without conflicts.

If a PR has failing checks, a merge conflict, or a non-eligible author, the merge queue skips it and moves on. When every eligible PR has been merged, the watch drains itself. You see which PRs were merged, which were skipped and why, and what is still pending.

**Example:** You submit three code tasks back-to-back. Each finishes and opens a PR against `development`. Instead of merging each one manually and rebasing the next, you create a merge queue watch. The system merges PRs #1401, #1402, and #1403 in sequence, waiting for CI to pass on each before proceeding to the next. You come back to a clean branch with all three changes integrated.

### Detect and Resolve Merge Conflicts Automatically

When someone pushes to a base branch, the agent checks every bot-authored PR targeting that branch for merge conflicts. If a conflict appears, the system dispatches a resolution task to your worker — the same way it dispatches any other code task. A dedicated cron job reconciles PR state every minute, syncing open/closed status and refreshing conflict information from GitHub into Firestore. Closed PRs are skipped automatically, so the cron does not waste time on stale data.

The reconciliation runs as a separate Cloud Scheduler job, decoupled from the webhook pipeline. This means conflict detection does not block webhook processing, and the state stays consistent even if a webhook is missed.

**Example:** Your co-founder merges a PR to `development` that renames a utility function. Two of your bot-authored PRs import that function. Within a minute, the cron detects the conflict, and the agent dispatches resolution tasks for both PRs. By the time you check the dashboard, the conflicts are resolved and the PRs are ready to merge.

### Design First, Then Build — With Explicit Mode Selection

Every task moves through two distinct phases. In the first, the agent interprets your request, creates a Linear issue, and produces a design — which files it will change, what approach it will take, and how it plans to verify the result. Then it stops. No code is written. You review the design on your own schedule: over coffee, on the train, between meetings. If the approach looks right, you approve it. If not, you redirect. Only after your explicit approval does the second phase begin — writing code, running tests, and opening a pull request.

You can now explicitly choose between planning and execution mode when submitting a task via the `taskMode` parameter. If you already have a plan and want to skip the design phase, set `taskMode: 'execution'` to go straight to implementation. If you want the design-first workflow, set `taskMode: 'planning'`. Omitting the parameter uses the default behavior.

Execution tasks can also be scheduled for a future dispatch time. Scheduled tasks enter the queue immediately, but the queue drainer skips them until their `notBeforeAt` time. The queue TTL starts from the later of `queuedAt` and `notBeforeAt`, so scheduled wait time does not expire the task before it becomes eligible.

This checkpoint exists because the most expensive mistake an AI coding tool can make is building the wrong thing quickly. A two-minute design review costs nothing. A pull request built on a misunderstanding costs an hour of review and a round trip back to square one.

The design phase also creates a paper trail. Every task has a Linear issue, a plan, and an approval record before any code exists. When you look back weeks later, you know exactly what was requested, what was proposed, and what was built — not just a diff with no context.

**Example:** You ask the agent to add date filtering to the activity dashboard. The design comes back proposing to filter the data after loading everything into the browser. You know the dataset will grow to millions of rows, so you reply: "Filter in the database query instead — do not load everything first." The agent revises its plan. When the execution phase runs, it builds the right solution on the first attempt.

### Code Tasks Grouped by Linear Issue — With Important Flags

Tasks are no longer a flat list. The dashboard groups tasks by the Linear issue they belong to, showing each issue as a single row with aggregated status, pipeline progress, and action states. You see at a glance which issues have tasks in progress, which need your attention, which are done, and which have failed — all with server-side pagination and sorting.

Each group displays its pipeline steps (planned, implemented, reviewed, remediated) and a consolidated status badge: active, needs-action, done, failed, or archived. Filter by status to focus on what matters — "needs-action" shows groups waiting for your approval or review, while "archived" hides completed work from your daily view.

You can now mark issue groups as important, flagging them for high-priority attention. Batch archiving lets you select multiple groups and archive them in a single action.

**Example:** You have twelve Linear issues with active code tasks. Instead of scrolling through thirty individual tasks, you see twelve rows. The `INT-445` row shows "needs-action" because the planning task finished and the implementation is waiting for your approval. You flag `INT-500` as important because it blocks the release. You tap the row, review the plan, and approve — all without losing context.

### Auto-Archive Merged Code Tasks

Tasks whose pull requests have been merged are archived automatically after seven days. A daily Cloud Scheduler job scans for non-archived tasks with a `prMergedAt` timestamp older than the threshold, groups them by Linear issue, and archives entire groups where all tasks are in terminal states with merged PRs. Active tasks in the same group prevent archival — the system never archives a group with in-progress work.

**Example:** You merged three PRs last week. Without lifting a finger, the tasks that produced those PRs are now archived and out of your active view. Your task dashboard shows only the work that still needs attention.

### Independent Verification — Two AIs, Two Providers

The agent does not grade its own homework. Claude writes the code inside an isolated container on your machine. When the task finishes, a separate Gemini 2.5 Flash model — running on Google's infrastructure, with no shared context — independently verifies the result. Gemini extracts structured data from the agent's execution logs and performs deep semantic validation, reading up to 200,000 characters of transcript to confirm that the task was actually completed, not just attempted.

This matters because a single model can convince itself that broken code works. When one AI writes and a different AI from a different provider verifies, the failure modes do not overlap. A hallucination that fools Claude is unlikely to also fool Gemini examining the raw evidence from a completely different angle.

The verification is not a rubber stamp. Gemini reads the test output, checks whether the PR was opened, and evaluates whether the agent's work matches what you originally asked for. If the evidence does not support completion, the task is marked accordingly — you see the real status, not an optimistic one.

**Example:** The agent finishes a task and reports success. Gemini reads the execution log, finds that two of six tests failed during the final run, and flags the task as incomplete. You see this on the dashboard immediately instead of discovering broken tests after merging the PR.

### Your Infrastructure, Your Code — With Inherited LLM Settings

Every line of code the agent writes is produced inside an isolated environment running on a machine you configure and control — a desktop in your office, a cloud server in your own account, any Unix machine with an internet connection. Your source code never leaves your network. The agent connects to your worker through your own infrastructure, using your own AI subscription for the compute. You own the machine, you own the code, you own the bill.

You name your workers, order them by priority, and the system handles the rest. If the primary worker is occupied, the agent routes to the next available one. Health checks confirm each worker is reachable before dispatching, so you know immediately if something is misconfigured. If all workers are busy, tasks enter a queue and dispatch automatically when capacity opens. Worker credentials — the keys that connect the agent to your machines — are encrypted with AES-256-GCM at rest and masked in every API response.

Multiple worker types are available across several AI providers — including Claude, MiniMax, MiMo Pro 2.5, GLM, Qwen, Kimi, Codex, and OpenRouter-backed options — so you pick the model that fits the task, or let the agent choose automatically. Different agent types (planning, execution, review, remediation) can be tuned to use different worker types independently. The GitHub Agent uses OpenRouter Gemini 3 Flash Preview for tool-calling triage, trying the user's OpenRouter key first and falling back to the platform key when needed.

When a task needs more time than the default worker budget, the submission can include `timeoutHours` from 1 to 12. Code Agent stores the override on the task and forwards it to the orchestrator, which applies it to that task's warning and hard-kill timers. If the field is omitted, the orchestrator uses its default timeout.

**Example:** You set up a high-spec desktop as your primary worker and a cloud VM as your backup. During a busy afternoon, you submit three tasks in quick succession. The first runs on your desktop, the second routes to the cloud VM, and the third queues until a slot opens — all without you making a single routing decision.

### Turn PR Comments into Working Code

The feedback loop between you and the agent extends to where developers already work — the pull request itself. Leave a review comment on any bot-authored PR, and the agent detects the actionable feedback automatically. If a task is already linked to that PR, the comment is forwarded to it. If no task exists, the agent creates one from scratch — resolving your GitHub username to your IntexuraOS account, generating a Linear issue from the PR title, and dispatching the new task with full PR context.

The PR title is automatically updated to include the Linear issue ID — `[INT-123] Fix auth bug` — so your project tracker and your repository stay linked without manual effort. When an existing task has finished, the comment resumes it with preserved context; the agent picks up where it left off, not from zero.

Mid-task communication works the same way. While a task is running, you can send it new instructions through the dashboard. The message is queued and delivered at the next safe pause point. Realized you forgot an edge case? Send it. Changed your mind about the approach? Say so. The agent adjusts course within the same task.

If a task fails or produces a result that is close but not quite right, you retry it with additional guidance. Retried tasks inherit the open PR branch, so work is not lost. The original task is archived, keeping your task list focused on what is active.

**Example:** The agent opens a PR for a new API endpoint. Your co-founder reviews it and comments: "Add rate limiting to this endpoint." The agent picks up the comment, creates a Linear issue, and pushes an update to the same PR — all without you intervening.

### CI Failure Auto-Handling

When CI checks fail on a bot-authored PR, the system detects the failure through the GitHub webhook pipeline and can retry or escalate without user intervention. Failed checks on agent PRs are evaluated through the same two-tier pipeline (hard rules then LLM triage) — the system decides whether to dispatch a fix task, skip, or escalate to the dashboard.

**Example:** The agent opens a PR and CI fails because a snapshot test needs updating. The system detects the failure, creates a follow-up task to update the snapshot, and the fix is pushed to the same branch — all before you check the dashboard.

### Self-Healing Failure Triage

When a task fails, the system classifies the failure and determines whether to auto-retry on a different worker, retry on the same worker, or escalate to the dashboard. Tasks that fail with exit code overrides — indicating transient infrastructure issues — are automatically retried up to three times, each attempt excluding the worker location that failed. The triage records which worker failed and routes the retry elsewhere, maximizing the chance of success without human intervention.

**Example:** A task fails because the primary worker's Docker daemon is temporarily unresponsive. The triage system detects the transient error, excludes that worker, and dispatches the retry to your backup worker. You see the task complete successfully without ever knowing about the infrastructure hiccup.

### Robust Task Finalization

A dedicated status endpoint (`PATCH /internal/code-tasks/:id/status`) ensures task completion is committed to Firestore reliably, separate from the side-effect-heavy webhook. The orchestrator writes the terminal status first via this lightweight, idempotent endpoint, then fires the full completion webhook for notifications, Linear updates, and PR labeling. If the webhook fails, the task is already in the correct terminal state — no more stalled tasks from webhook timeouts.

Callback routing is owned by the task, not by the worker machine that happens to run it. Code Agent records callback owner state (`dev`, `prod`, or `custom`) from the task webhook URL, normalizes public dev/prod callbacks through `/api/code/internal/...`, and exposes callback success or failure diagnostics on the task.

**Example:** The orchestrator finishes a task and the completion webhook times out due to a transient network issue. Because the status was already committed via the dedicated endpoint, the task shows the correct final state in the dashboard immediately. The webhook retries and handles the side effects later.

### Dispatch Recovery and Visibility

When dispatch cannot start, Code Agent now records why instead of leaving the task as an unexplained queue row. Recoverable blockers such as worker capacity or temporary reachability keep the task queued with a visible `dispatchStatus`; terminal blockers fail the task with a remediation message. Queue and task APIs expose active system statuses, worker health diagnostics, affected task counts, and the next action (`will_retry_automatically`, `retry_after_fix`, `wait_until_scheduled`, or `wait_for_active_task`).

The same reporting path writes task log lines, PR automation log entries, and deduplicated WhatsApp notifications, so users can see whether the scheduler will retry automatically or they need to fix worker configuration.

### PR Triage via Pub/Sub

PR triage processing now routes through a Pub/Sub push subscription instead of running inline in the GitHub webhook handler. The webhook publishes a triage event to a topic, and the push subscription delivers it to a dedicated endpoint for evaluation. This decouples the webhook response from the triage compute — the webhook returns immediately, and triage runs asynchronously.

**Example:** A flurry of PR comments arrives simultaneously. Instead of the webhook handler blocking on each triage evaluation, it publishes events to Pub/Sub and returns 200 instantly. The triage evaluations run concurrently through the push subscription, and each event is processed without blocking the others.

### Guardrails and Cost Control

The agent enforces per-user limits in real time: three concurrent tasks, ten per hour, and two hundred dollars per month. These limits are checked before work begins, not reconciled after the bill arrives. You always know what the work costs before you commit to it.

Every prompt passes through two sanitization layers before reaching your worker. The first strips embedded secrets — AWS keys, API tokens, private keys, passwords — so sensitive credentials never reach the AI model. The second rejects prompt injection patterns — system override markers, encoded payloads, and control characters — preventing attempts to manipulate the agent's behavior. Prompts are capped at 10,000 characters, and a four-layer deduplication system prevents the same task from being created twice.

Tasks that go silent for thirty minutes trigger zombie detection — the system interrupts the hung process automatically, so a stalled task does not burn through your budget overnight. The zombie sweep now runs every five minutes for faster detection. WhatsApp notifications arrive when a task starts, finishes, or fails, each with a tap-to-open button linking to the pull request or the task dashboard. Merge conflicts on bot-authored PRs are detected automatically and dispatched for resolution without manual intervention. Draft PRs are blocked from triggering code tasks entirely — no wasted compute on work-in-progress branches.

**Example:** You submit a task before bed. The agent finishes at 2 a.m. and sends a WhatsApp notification with a button linking to the pull request. When you wake up, you tap the button, review the PR, and merge it before breakfast. If the task had stalled, the five-minute zombie sweep would have interrupted it and notified you — no runaway compute, no surprise bill.

### Full Visibility into Every Decision

While the agent works, a live terminal view in the dashboard streams its output in real time — every file it reads, every test it runs, every decision it makes. You are not waiting for a notification that says "done." You are watching the work happen.

Each completed task includes per-task metrics: processing time, memory consumed, tokens used, and a cost breakdown. A separate Gemini model analyzes the agent's output and writes a three-to-five sentence narrative summary — what was built, which decisions were made, and what was delivered. This summary appears on the task card and in notifications, so you understand the outcome at a glance without reading the full log.

On the GitHub side, every action taken on a pull request — triage decision, task dispatched, task completed, error encountered — is collected into a single chronological comment on the PR itself. Instead of piecing together what happened from scattered notifications, you read one comment that tells the full story. A GitHub event decision log in the dashboard shows every webhook event, which evaluation path it took, and what action resulted. You can expand any row to inspect the full raw webhook payload — full transparency into the automation pipeline.

**Example:** A task has been running for twenty minutes and you want to know if it is stuck. You open the dashboard, see the live log showing the agent midway through the test suite, and close the tab. No guessing, no pinging, no waiting.

## Getting Started

Connect a worker machine, link your Linear and GitHub accounts through the dashboard, and submit your first task — by typing in the web console, sending a WhatsApp message, or recording a voice note. The agent handles everything from issue creation through pull request.

## Key Benefits

- **Execution memory makes the agent smarter over time** — Lessons from previous runs are retrieved and injected into future tasks, reducing repeated mistakes
- **Autonomous remediation closes the review loop** — Review findings trigger automatic fix tasks, running without human intervention until the PR is clean
- **Ask Agent for interactive exploration** — Back-and-forth conversations with Claude Code directly from the dashboard, with persistent sessions across devices
- **Merge queue eliminates manual PR coordination** — Bot-authored PRs merge in order, automatically, with CI checks verified before each merge
- **Merge conflict resolution runs unattended** — Conflicts are detected by a dedicated cron job and dispatched for resolution without blocking the webhook pipeline
- **Design before code with explicit mode selection** — Choose planning or execution mode, or let the system default; you approve the plan before a single line is written
- **Scheduled dispatch and custom timeouts** — Execution tasks can wait until a future dispatch time and can carry a per-task timeout override
- **Independent two-provider verification** — Claude writes the code, Gemini independently verifies the result, so no single model grades its own work
- **Voice note to pull request** — Record a WhatsApp voice note about a bug, and the system transcribes, classifies, designs, codes, tests, and opens a pull request without you touching a keyboard
- **Your machines, your code, your LLM settings** — Source code stays on infrastructure you own, using your own AI subscriptions and model preferences, with credentials encrypted at rest
- **Issue-grouped task dashboard with important flags** — Tasks grouped by Linear issue with aggregated status, pipeline progress, batch operations, and priority marking
- **Auto-archive keeps the dashboard clean** — Merged tasks are archived automatically after seven days, and stale groups are cleaned up hourly
- **PR comments become tasks** — Review feedback on a pull request automatically creates or resumes a task with full context, keeping the loop inside GitHub
- **Self-healing failure triage** — Failed tasks are automatically classified, retried on different workers, or escalated based on the failure type
- **Robust task finalization** — Dedicated status endpoint ensures tasks reach terminal state even if the completion webhook fails
- **Dispatch and callback diagnostics** — Queue blockers, worker health details, callback owner, and callback failures are visible on task and queue surfaces
- **Asynchronous PR triage** — Pub/Sub decouples webhook response time from triage evaluation, preventing webhook timeouts during heavy event loads
- **Draft PR blocking** — Code tasks are blocked on draft PRs, preventing wasted compute on work-in-progress changes
- **Predictable spend** — Per-user limits on concurrency, hourly rate, and monthly cost are enforced before the work begins, not after
- **Full audit trail** — Live logs, per-task metrics, cost breakdowns, narrative summaries, expandable webhook payloads, and a unified PR automation log give you complete visibility

## Limitations

- **Design phase adds a deliberate pause** — The approval checkpoint means tasks take longer to start than fully autonomous tools, because the system prioritizes building the right thing over building fast
- **Prompt length capped at 10,000 characters** — Very long task descriptions need to be broken into smaller, focused requests
- **Queued tasks expire after 24 hours** — If all workers remain busy beyond the TTL, the task expires and you are notified
- **Mid-task messages arrive at safe pause points** — Instructions sent to a running task are delivered at the next pause, not mid-operation
- **Retry cooling period** — After a task fails, a mandatory wait prevents runaway retry loops
- **Planning requires explicit labeling** — Autonomous planning only runs on Linear issues tagged with the designated label
- **Merge queue watches the `main` branch with a blocked flag** — The `main` branch appears in the branch list for visibility but cannot be used as a merge queue base branch
- **Execution memory is in alpha** — The memory graph is focused on data collection and RAG pipeline tuning; memory retrieval quality is being actively adjusted

_Part of [IntexuraOS](../overview.md) — describe what you want, come back to a pull request._

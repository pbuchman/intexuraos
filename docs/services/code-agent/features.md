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

### Queue and Auto-Merge Pull Requests

When multiple bot-authored PRs target the same branch, merging them one-by-one invites conflicts. The merge queue watches a base branch, checks each PR's CI status and mergeability, and merges the oldest eligible PR automatically on every tick — driven by Cloud Scheduler. You create a watch from the dashboard, and the system drains PRs in order without conflicts.

If a PR has failing checks, a merge conflict, or a non-eligible author, the merge queue skips it and moves on. When every eligible PR has been merged, the watch drains itself. You see which PRs were merged, which were skipped and why, and what is still pending.

**Example:** You submit three code tasks back-to-back. Each finishes and opens a PR against `development`. Instead of merging each one manually and rebasing the next, you create a merge queue watch. The system merges PRs #1401, #1402, and #1403 in sequence, waiting for CI to pass on each before proceeding to the next. You come back to a clean branch with all three changes integrated.

### Detect and Resolve Merge Conflicts Automatically

When someone pushes to a base branch, the agent checks every bot-authored PR targeting that branch for merge conflicts. If a conflict appears, the system dispatches a resolution task to your worker — the same way it dispatches any other code task. A dedicated cron job reconciles PR state every minute, syncing open/closed status and refreshing conflict information from GitHub into Firestore. Closed PRs are skipped automatically, so the cron does not waste time on stale data.

The reconciliation runs as a separate Cloud Scheduler job, decoupled from the webhook pipeline. This means conflict detection does not block webhook processing, and the state stays consistent even if a webhook is missed.

**Example:** Your co-founder merges a PR to `development` that renames a utility function. Two of your bot-authored PRs import that function. Within a minute, the cron detects the conflict, and the agent dispatches resolution tasks for both PRs. By the time you check the dashboard, the conflicts are resolved and the PRs are ready to merge.

### Design First, Then Build

Every task moves through two distinct phases. In the first, the agent interprets your request, creates a Linear issue, and produces a design — which files it will change, what approach it will take, and how it plans to verify the result. Then it stops. No code is written. You review the design on your own schedule: over coffee, on the train, between meetings. If the approach looks right, you approve it. If not, you redirect. Only after your explicit approval does the second phase begin — writing code, running tests, and opening a pull request.

This checkpoint exists because the most expensive mistake an AI coding tool can make is building the wrong thing quickly. A two-minute design review costs nothing. A pull request built on a misunderstanding costs an hour of review and a round trip back to square one.

The design phase also creates a paper trail. Every task has a Linear issue, a plan, and an approval record before any code exists. When you look back weeks later, you know exactly what was requested, what was proposed, and what was built — not just a diff with no context.

**Example:** You ask the agent to add date filtering to the activity dashboard. The design comes back proposing to filter the data after loading everything into the browser. You know the dataset will grow to millions of rows, so you reply: "Filter in the database query instead — do not load everything first." The agent revises its plan. When the execution phase runs, it builds the right solution on the first attempt.

### Independent Verification — Two AIs, Two Providers

The agent does not grade its own homework. Claude writes the code inside an isolated container on your machine. When the task finishes, a separate Gemini 2.5 Flash model — running on Google's infrastructure, with no shared context — independently verifies the result. Gemini extracts structured data from the agent's execution logs and performs deep semantic validation, reading up to 200,000 characters of transcript to confirm that the task was actually completed, not just attempted.

This matters because a single model can convince itself that broken code works. When one AI writes and a different AI from a different provider verifies, the failure modes do not overlap. A hallucination that fools Claude is unlikely to also fool Gemini examining the raw evidence from a completely different angle.

The verification is not a rubber stamp. Gemini reads the test output, checks whether the PR was opened, and evaluates whether the agent's work matches what you originally asked for. If the evidence does not support completion, the task is marked accordingly — you see the real status, not an optimistic one.

**Example:** The agent finishes a task and reports success. Gemini reads the execution log, finds that two of six tests failed during the final run, and flags the task as incomplete. You see this on the dashboard immediately instead of discovering broken tests after merging the PR.

### Your Infrastructure, Your Code

Every line of code the agent writes is produced inside an isolated environment running on a machine you configure and control — a desktop in your office, a cloud server in your own account, any Unix machine with an internet connection. Your source code never leaves your network. The agent connects to your worker through your own infrastructure, using your own AI subscription for the compute. You own the machine, you own the code, you own the bill.

You name your workers, order them by priority, and the system handles the rest. If the primary worker is occupied, the agent routes to the next available one. Health checks confirm each worker is reachable before dispatching, so you know immediately if something is misconfigured. If all workers are busy, tasks enter a queue and dispatch automatically when capacity opens. Worker credentials — the keys that connect the agent to your machines — are encrypted with AES-256-GCM at rest and masked in every API response.

Multiple worker types are available across several AI providers — you pick the model that fits the task, or let the agent choose automatically.

**Example:** You set up a high-spec desktop as your primary worker and a cloud VM as your backup. During a busy afternoon, you submit three tasks in quick succession. The first runs on your desktop, the second routes to the cloud VM, and the third queues until a slot opens — all without you making a single routing decision.

### Turn PR Comments into Working Code

The feedback loop between you and the agent extends to where developers already work — the pull request itself. Leave a review comment on any bot-authored PR, and the agent detects the actionable feedback automatically. If a task is already linked to that PR, the comment is forwarded to it. If no task exists, the agent creates one from scratch — resolving your GitHub username to your IntexuraOS account, generating a Linear issue from the PR title, and dispatching the new task with full PR context.

The PR title is automatically updated to include the Linear issue ID — `[INT-123] Fix auth bug` — so your project tracker and your repository stay linked without manual effort. When an existing task has finished, the comment resumes it with preserved context; the agent picks up where it left off, not from zero.

Mid-task communication works the same way. While a task is running, you can send it new instructions through the dashboard. The message is queued and delivered at the next safe pause point. Realized you forgot an edge case? Send it. Changed your mind about the approach? Say so. The agent adjusts course within the same task.

If a task fails or produces a result that is close but not quite right, you retry it with additional guidance. Retried tasks inherit the open PR branch, so work is not lost. The original task is archived, keeping your task list focused on what is active.

**Example:** The agent opens a PR for a new API endpoint. Your co-founder reviews it and comments: "Add rate limiting to this endpoint." The agent picks up the comment, creates a Linear issue, and pushes an update to the same PR — all without you intervening.

### Guardrails and Cost Control

The agent enforces per-user limits in real time: three concurrent tasks, ten per hour, and two hundred dollars per month. These limits are checked before work begins, not reconciled after the bill arrives. You always know what the work costs before you commit to it.

Every prompt passes through two sanitization layers before reaching your worker. The first strips embedded secrets — AWS keys, API tokens, private keys, passwords — so sensitive credentials never reach the AI model. The second rejects prompt injection patterns — system override markers, encoded payloads, and control characters — preventing attempts to manipulate the agent's behavior. Prompts are capped at 10,000 characters, and a four-layer deduplication system prevents the same task from being created twice.

Tasks that go silent for thirty minutes trigger zombie detection — the system interrupts the hung process automatically, so a stalled task does not burn through your budget overnight. WhatsApp notifications arrive when a task starts, finishes, or fails, each with a tap-to-open button linking to the pull request or the task dashboard. Merge conflicts on bot-authored PRs are detected automatically and dispatched for resolution without manual intervention.

**Example:** You submit a task before bed. The agent finishes at 2 a.m. and sends a WhatsApp notification with a button linking to the pull request. When you wake up, you tap the button, review the PR, and merge it before breakfast. If the task had stalled, the thirty-minute heartbeat timeout would have interrupted it and notified you — no runaway compute, no surprise bill.

### Full Visibility into Every Decision

While the agent works, a live terminal view in the dashboard streams its output in real time — every file it reads, every test it runs, every decision it makes. You are not waiting for a notification that says "done." You are watching the work happen.

Each completed task includes per-task metrics: processing time, memory consumed, tokens used, and a cost breakdown. A separate Gemini model analyzes the agent's output and writes a three-to-five sentence narrative summary — what was built, which decisions were made, and what was delivered. This summary appears on the task card and in notifications, so you understand the outcome at a glance without reading the full log.

On the GitHub side, every action taken on a pull request — triage decision, task dispatched, task completed, error encountered — is collected into a single chronological comment on the PR itself. Instead of piecing together what happened from scattered notifications, you read one comment that tells the full story. A GitHub event decision log in the dashboard shows every webhook event, which evaluation path it took, and what action resulted. You can expand any row to inspect the full raw webhook payload — full transparency into the automation pipeline.

**Example:** A task has been running for twenty minutes and you want to know if it is stuck. You open the dashboard, see the live log showing the agent midway through the test suite, and close the tab. No guessing, no pinging, no waiting.

## Getting Started

Connect a worker machine, link your Linear and GitHub accounts through the dashboard, and submit your first task — by typing in the web console, sending a WhatsApp message, or recording a voice note. The agent handles everything from issue creation through pull request.

## Key Benefits

- **Merge queue eliminates manual PR coordination** — Bot-authored PRs merge in order, automatically, with CI checks verified before each merge
- **Merge conflict resolution runs unattended** — Conflicts are detected by a dedicated cron job and dispatched for resolution without blocking the webhook pipeline
- **Design before code** — You approve the plan before a single line is written, so no compute is wasted on wrong assumptions
- **Independent two-provider verification** — Claude writes the code, Gemini independently verifies the result, so no single model grades its own work
- **Voice note to pull request** — Record a WhatsApp voice note about a bug, and the system transcribes, classifies, designs, codes, tests, and opens a pull request without you touching a keyboard
- **Your machines, your code** — Source code stays on infrastructure you own, using your own AI subscriptions, with credentials encrypted at rest
- **PR comments become tasks** — Review feedback on a pull request automatically creates or resumes a task with full context, keeping the loop inside GitHub
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

---

_Part of [IntexuraOS](../overview.md) — describe what you want, come back to a pull request._

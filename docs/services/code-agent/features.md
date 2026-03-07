# Code Agent

Describe what you want. Walk away. Come back to a pull request.

## The Problem

You know what needs to change. The signup flow shows a generic error when someone uses an existing email. The dashboard should filter by date range. A page returns the wrong error message when something goes wrong. You can describe the fix in thirty seconds. Getting it built takes hours -- or days, if the queue is long.

AI coding tools promise to close that gap, but most of them skip the part that matters. You type a prompt, and minutes later a pull request -- a proposed code change, submitted for your team to review -- appears, built on assumptions you never approved. Maybe it rewrote the wrong file. Maybe it chose an approach that conflicts with how the rest of the system works. You find out during code review, after the compute is spent and the time is gone. Now you are debugging AI output instead of shipping.

The deeper problem is not getting a machine to write code. It is getting a machine to write the *right* code -- and knowing, before it starts, whether it understood what you meant.

## Use Case: From Voice Note to Pull Request

You run a SaaS product and your morning is already full. This is what happens when an idea hits you between meetings.

1. You are driving when you realize the onboarding flow sends a confusing error message. You record a voice note on WhatsApp: "Fix the signup error -- when someone uses an email that already exists, tell them the account exists instead of showing a generic failure."

2. By the time you park, your voice note has been transcribed and classified as a code task, and a project issue has appeared in Linear -- your team's project tracker -- with a clear title and description.

3. The agent produces a design: which file handles the signup flow, what the new error message should say, which tests need updating, and how it plans to verify the fix. It stops there and waits.

4. Over coffee the next morning, you open the dashboard and read the design. It looks right. You approve it.

5. The agent picks up the task on your own machine, writes the code inside an isolated environment, runs the tests, and opens a pull request. A WhatsApp notification arrives with a direct-tap button linking to the PR.

6. Later that day, your co-founder reviews the PR and leaves a comment: "Can we also handle the case where the email has a different capitalization?" The agent detects the comment, picks up the feedback with the full context of the original work, and pushes an update. You never opened a code editor.

## How It Helps

### Design Before Code

Every task the code agent receives goes through two distinct phases. In the first, the agent interprets your request, creates a project issue, and produces a design -- an explanation of what it intends to build, which files it will touch, and how it plans to verify the result. Then it stops. No code is written. You review the design on your own schedule: over coffee, on the train, between meetings. If the approach looks right, you approve it. If not, you redirect. Only after your explicit approval does the second phase begin -- writing tests, writing code, running the automated test suite, and opening a pull request.

This checkpoint exists because the most expensive mistake an AI coding tool can make is building the wrong thing quickly. A two-minute design review costs almost nothing. A pull request built on a misunderstanding costs an hour of code review and a round trip back to square one.

**Example:** You ask the agent to add date filtering to the activity dashboard. The design comes back proposing to filter the data after loading all of it into the browser. You know the data set will grow to millions of rows, so you reply: "Filter the data in the database query instead -- do not load everything first." The agent revises the design. When the execution agent runs, it builds the right solution on the first attempt.

### Your Infrastructure, Your Code

Every line of code the agent writes is produced inside an isolated environment running on a machine you configure and control. Your source code never leaves your infrastructure. The agent connects to your worker through your own network, using your own Claude subscription for the AI compute. You own the machine, you own the code, you own the bill.

You can configure up to two worker machines, ordered by priority. If the primary worker is occupied with another task, the agent automatically routes to the secondary -- no manual intervention, no waiting in a queue. Health checks confirm each worker is reachable before dispatching, so you know immediately if something is misconfigured rather than discovering it mid-task. If both workers are busy, tasks enter a queue and dispatch automatically when capacity opens.

**Example:** You set up a high-spec desktop as your primary worker and a cloud VM as your backup. During a busy afternoon, you submit three tasks in quick succession. The first runs on your desktop, the second routes to the cloud VM, and the third queues until a slot opens -- all without you making a single routing decision.

### Talk to Running Tasks

The conversation between you and the agent does not end when you press submit. While a task is running, you can send it new instructions through the dashboard -- the message is queued and delivered at the next safe pause. Realized you forgot to mention an edge case? Send it. Changed your mind about the approach? Say so. The agent picks up your message and adjusts course.

After a pull request is open, the feedback loop shifts to where developers already work -- the PR itself. Leave a review comment, and the agent detects the actionable feedback automatically. When no existing task is linked to the PR, the agent creates one from scratch -- resolving the commenter's GitHub username to an IntexuraOS user, auto-creating a Linear issue from the PR title, and dispatching the task with full PR context. When an existing task is found, the comment is forwarded to it -- queued if the task is still running, or used to resume it if it has finished. The agent picks up where it left off with the full context of the original work intact.

If a task fails or produces a result that is close but not quite right, you can retry it with additional guidance. Failed tasks observe a cooling period -- long enough to prevent runaway retries, short enough to keep you moving. Completed tasks can be resumed with new context, pushing further without losing what was already built. Retried tasks archive the original, keeping your task list focused on active work.

**Example:** You approve a design and the agent starts coding. Halfway through, you realize the feature also needs to update the help text users see when they hover over a form field. You send a mid-task message through the dashboard: "Also update the tooltip on the email field." The agent receives the message at its next pause point and includes the change in the same pull request.

### Real-Time Visibility

While the agent works, a live terminal view in the web dashboard streams its output as it happens -- every file it reads, every test it runs, every decision it makes. You are not waiting for an email that says "done." You are watching the work unfold.

Each task is tracked from the moment you submit it through completion. Per-task metrics break down exactly what happened: processing time, memory used, AI tokens consumed, and how time was split across API calls, tool execution, and overhead. A timeline view on the dashboard shows every pull request event -- new versions pushed, reviews submitted, comments left -- with links back to the source. The dashboard shows live Linear issue data alongside each task, so you see the current issue state without switching tools. Logs are retained for ninety days.

**Example:** A task has been running for twenty minutes and you want to know if it is stuck or making progress. You open the dashboard, see the live log stream showing the agent is midway through running the test suite, and close the tab. No guessing, no pinging, no waiting.

### Guardrails That Stay Out of the Way

The agent enforces per-user limits on concurrent tasks (three at a time), hourly rate (ten per hour), and spend (twenty dollars per day, two hundred per month) -- so you always know what the work costs before the bill arrives. The estimated cost per task is about $1.17. These limits are enforced in real time, not reconciled after the fact.

Every prompt passes through two sanitization layers before reaching your worker. The first strips embedded secrets -- AWS keys, API tokens, private keys, passwords in environment variables -- so sensitive credentials are never sent to the AI model. The second rejects prompt injection patterns -- system override markers, base64 blobs, and control characters -- preventing attempts to manipulate the agent's behavior.

Tasks that go silent for thirty minutes are automatically interrupted, so a hung process does not burn through your budget overnight. WhatsApp notifications arrive when a task starts, finishes, or fails -- each with a direct-tap CTA button linking to the pull request or the task dashboard. You stay informed without checking a dashboard. If a task encounters a transient infrastructure error (such as a Cloudflare tunnel glitch), the dispatch system recognizes it as retryable and routes to an alternate worker automatically.

**Example:** You submit a task before bed. The agent finishes at 2 a.m. and sends a WhatsApp notification with a tap-to-open button linking to the pull request. When you wake up, you tap the button, review the PR, and merge it before breakfast. If the task had failed, you would have seen that notification too -- with a "Check Logs" button to jump straight to the task details.

## Getting Started

Connect a worker machine, link your Linear and GitHub accounts through the dashboard, and submit your first task -- by typing in the web console, sending a WhatsApp message, or recording a voice note. The agent handles everything from issue creation through pull request.

## Key Benefits

- **Design before code** -- You approve the plan before a single line is written, so no compute is wasted on wrong assumptions
- **Your machines, your code** -- Source code stays on infrastructure you own and control, using your own Claude subscription
- **Responds to PR feedback** -- Review comments on the pull request are forwarded to the agent, or a new task is created automatically if none exists, picking up with full context
- **Submit from anywhere** -- WhatsApp voice note, typed message, or web dashboard, every path leads to the same workflow
- **Predictable spend** -- Per-user limits on concurrency, hourly rate, daily and monthly cost, enforced before the work begins
- **Always watching** -- Live log streaming, per-task metrics, WhatsApp CTA buttons, and live Linear data hydration mean you know what is happening without switching tools
- **Multi-model support** -- Choose from Claude Opus, Sonnet, MiniMax, GLM, or Qwen models, or let the agent pick automatically

## Limitations

- **Design phase adds a deliberate pause** -- Teams that prefer fully autonomous execution will find this slower by design, because the checkpoint exists to prevent wasted work
- **Two worker machines per user** -- You can configure a primary and a fallback, but not a larger pool
- **Retry cooling period** -- After a task fails, you must wait before retrying, to prevent runaway loops
- **Mid-task messages are not instantaneous** -- Messages sent to a running task are delivered at the next safe pause, not mid-operation
- **WhatsApp notifications require a connected account** -- Without WhatsApp linked, you rely on the dashboard for status updates
- **Prompt length capped at 10,000 characters** -- Very long task descriptions need to be broken into smaller requests
- **Queued tasks expire after 30 minutes** -- If all workers remain busy beyond the queue TTL, the task fails and you are notified

---

_Part of [IntexuraOS](../overview.md) -- describe what you want, come back to a pull request._

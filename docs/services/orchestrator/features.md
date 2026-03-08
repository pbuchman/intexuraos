# Orchestrator

Your coding workforce, running on your own hardware.

## The Problem

Every AI coding agent on the market asks for the same thing: send us your code. Ship your repository to our servers, let our infrastructure execute against it, and trust that nothing leaks, nothing persists, and nothing gets logged where it should not. For a side project, maybe that is fine. For a company with compliance requirements, customer data in the repo, or proprietary algorithms they have spent years building, it is a non-starter.

The workaround is obvious in theory: run the agent on your own machine. But anyone who has tried knows what follows. You need isolated environments so concurrent tasks do not corrupt each other. You need credential management that does not leave API keys sitting in plaintext. You need crash recovery, because the spare server under the desk will eventually lose power, and a half-finished pull request should not become an orphan. You need log streaming, because an autonomous agent working in silence is an autonomous agent you cannot trust. Each of these problems is solvable individually. Solving all of them together, reliably, on hardware you manage yourself — that is the work the orchestrator eliminates.

The result is a system where your source code never leaves your network. The orchestrator sends task status, logs, and performance metrics to the platform. AI inference calls go directly from your machine to the model provider. Your infrastructure stays under your control. The platform sees an endpoint, not your codebase.

## Use Case: A Spare Server Becomes a Development Team

A startup CTO has a workstation sitting idle after an office move — a machine with Docker installed and nothing to do. She wants her team's Linear issues handled by autonomous coding agents, but the company's security policy prohibits source code on third-party infrastructure.

1. She installs the orchestrator on the idle workstation and connects it to IntexuraOS through a Cloudflare tunnel — an outbound-only encrypted connection. The machine never accepts inbound traffic from the internet.
2. A developer files a Linear issue describing a new API endpoint. The platform dispatches the task to her orchestrator.
3. The orchestrator creates a dedicated copy of the repository on its own branch and spins up a Docker container scoped to that workspace — its own credentials, its own resource limits, its own log stream.
4. The worker enters the Planning Agent flow: it analyzes the issue, enriches it with context, designs an approach, and adds labels to Linear. No code is committed yet.
5. The CTO reviews the design from her dashboard, watching logs stream in real time. She sends a mid-task message clarifying a requirement.
6. The worker moves to the Execution Agent flow: it writes tests, implements the endpoint, runs the automated test suite, and opens a pull request on GitHub.
7. An independent verifier checks the result. The Execution Agent path is verified semantically from Claude responses (including the `EXECUTION_AGENT_FINAL` contract), and `code-agent` performs deterministic Linear enforcement on success. The worker did not self-report — the platform confirmed independently.
8. The CTO reviews a clean pull request. Her source code never left the building.

## How It Helps

### Run on Any Machine You Control

The orchestrator turns any Unix machine into a worker station. A server rack in your office, a cloud VM in your preferred region, a repurposed laptop collecting dust — the requirements are Docker and a Cloudflare tunnel. From the platform's perspective, your machine is just an endpoint. No shared databases, no co-located services, no complex networking. The single outbound tunnel is the only connection to IntexuraOS, and your machines remain fully yours.

You can run one orchestrator or several, each on different hardware, each in a different location. The platform dispatches work to whichever is available. Geography becomes irrelevant.

**Example:** A fintech company runs one orchestrator on a VM in Frankfurt for GDPR-sensitive repositories and another on a workstation in their New York office for US-based projects. Both appear as worker endpoints to the platform. The source code in each location never crosses the Atlantic.

### Choose Your Model Provider

Each task specifies a worker type that determines which AI model provider handles the inference. The orchestrator supports Anthropic (opus, auto, sonnet), ZAI (glm), MiniMax (MiniMax-M2.5), and Alibaba Cloud (qwen3.5-plus). OAuth credentials for Anthropic models are managed automatically — the orchestrator reads Claude CLI credentials, refreshes tokens before they expire, and propagates fresh credentials to every running container. Third-party API keys are validated at startup so you know immediately if a provider is misconfigured.

**Example:** A team routes complex architecture tasks to opus for maximum reasoning depth, routine bug fixes to sonnet for speed and cost efficiency, and batch documentation tasks to qwen3.5-plus. The orchestrator dispatches each to the right provider without manual intervention.

### Isolate Every Task Automatically

When a task arrives, the orchestrator creates a dedicated copy of the repository on its own branch. It then spawns a Docker container locked to that workspace — each container runs with restricted capabilities and cannot reach outside its own workspace or modify the host machine. Two tasks running simultaneously never see each other's files, credentials, or output. The default capacity is two concurrent tasks, configurable based on your hardware.

A sensitive file guard scans every commit for credential patterns — over twenty rules covering environment files, certificates, private keys, infrastructure state, and more. If a worker commits something it should not, the guard reverts the file before results are pushed to your repository.

**Example:** Two developers file issues at the same time — one for a payment integration, another for a dashboard redesign. The orchestrator runs both concurrently in separate containers, each with its own mounted workspace and credentials. The payment task's API keys are never visible to the dashboard task. Neither worker can interfere with the other's branch.

### Verify Completion Independently

Autonomous agents have a persistent habit: declaring the work done when it is not. The orchestrator addresses this with an independent verification step after every attempt. A Gemini model evaluates the semantic completeness of each agent's final output block from Claude responses, extracting structured metadata (PR URLs, skill usage proofs, outcome labels) and validating them against agent-specific Zod schemas. The worker's own assessment of its performance is not consulted.

If verification fails and the attempt count has not reached the configurable maximum (three by default), the orchestrator automatically launches a follow-up attempt with a resume prompt listing exactly which criteria were not met. If the verifier itself is unavailable, the task fails outright rather than allowing an unverified result through. The system prefers a failed task over a false positive.

**Example:** A worker completes an API endpoint but forgets to update the test suite. The verifier catches the missing test coverage and triggers a second attempt. The resume prompt tells the worker precisely what was incomplete. On the second attempt, the worker adds the tests, CI passes, and the verifier confirms completion. The developer who filed the issue sees a clean pull request — not a half-finished one that needs manual cleanup.

### Follow the Work in Real Time

Logs stream back to the platform as they happen, flushed every three seconds, so you can watch a worker's progress from the dashboard as if you were looking over a colleague's shoulder. Docker stream headers and ANSI escape codes are stripped automatically, and every line is timestamped for readability. Per-task metrics — processing time, peak memory usage, AI token consumption, time spent waiting on API calls versus executing tools — flow back alongside the logs. You know exactly what each task costs and where the time went.

A heartbeat pings the platform every ten minutes. If the orchestrator goes silent, the platform knows immediately rather than waiting for a timeout. No stalled task occupies capacity without someone noticing.

**Example:** A team lead watches the orchestrator work through a complex refactoring task. Forty minutes in, she notices the worker is heading down the wrong path. She sends a mid-task message with a clarification, which the orchestrator queues and delivers when the current attempt finishes — triggering a follow-up with her feedback incorporated. Without real-time visibility, she would have discovered the problem only after reviewing a flawed pull request.

### Split Planning From Execution

Tasks follow a deliberate agent-based workflow. In the Planning Agent flow, the worker analyzes the issue, reads all Linear comments (including clarifications from previous runs), makes an explicit complexity judgment, and either enriches the issue description in place (simple tasks) or creates subtasks with parallel work breakdowns and opens a planning PR (complex tasks). In the Execution Agent flow, the worker writes tests, implements the solution, runs the automated test suite, performs a mandatory code review loop, and creates a pull request. The Pull Request Agent handles comment-driven follow-up work on existing PRs.

The planning and execution flows can run as separate tasks, giving you a natural review checkpoint. Approve the plan, then let the worker execute. For execution tasks that follow a planning phase, the orchestrator automatically merges the planning PR branch into the execution worktree so the worker starts with the approved design context.

**Example:** A developer files an issue to add OAuth support to an existing API. The worker's Planning Agent flow produces an enriched issue with the proposed approach: which endpoints change, which new dependencies are needed, which tests cover the integration. The developer reviews the plan, spots a missing edge case, and adds a comment. Only then does the Execution Agent flow begin — with the edge case already accounted for.

### Survive Crashes and Restarts

The orchestrator persists task state to disk. If the machine reboots, the process crashes, or Docker restarts, it discovers running containers on startup and attempts to adopt them — re-attaching to live containers so tasks continue without interruption. If a container has exited or is unreachable, the platform is notified and the container is cleaned up. Stale workspaces and leftover containers are garbage-collected automatically. Each attempt has a two-hour timeout — with a warning at one hour and fifty-five minutes and a hard kill at two hours — so a stuck task never occupies a worker indefinitely.

When forensics mode is enabled, the orchestrator captures core dumps, exec stream persistence, and crash snapshots for failed containers, giving you deep diagnostic data when something goes wrong.

**Example:** A thunderstorm knocks out power to the office server running the orchestrator. When power returns and the machine reboots, the orchestrator starts up, discovers one still-running container and adopts it, detects one exited container and cleans it up, notifies the platform about an interrupted task, and resumes accepting new work — all without human intervention.

## Getting Connected

Install the orchestrator on any Unix machine with Docker, set up a Cloudflare tunnel (free tier available), and point it at your IntexuraOS instance. The machine becomes a worker endpoint within minutes. Your code stays on your hardware from the first task onward.

## Key Benefits

- **Infrastructure sovereignty** — Your source code never leaves your network; outbound data is limited to task status, logs, and performance metrics
- **Model flexibility** — Route tasks to Anthropic, ZAI, MiniMax, or Alibaba Cloud models based on complexity and cost requirements
- **Location independence** — Any Unix machine with Docker becomes a worker station, connected through a single outbound tunnel
- **Concurrent isolation** — Each task gets its own branch, container, credentials, and resource limits with no cross-task visibility
- **Independent verification** — Completion is confirmed by Gemini semantic analysis with agent-specific schema validation, not worker self-reporting
- **Credential guard** — A sensitive file scanner checks every commit against twenty-plus rules and reverts anything that looks like a secret before it reaches your repository
- **Self-correcting execution** — Failed verification triggers automatic follow-up attempts with targeted resume prompts
- **Crash resilience** — Survives reboots, adopts running containers, cleans up orphaned work, and notifies the platform without manual intervention

## Limitations

- **One machine per orchestrator** — Each orchestrator runs on a single machine; for most teams, one or two is enough, and you add more machines rather than expanding a single one
- **Docker required** — The host machine must have Docker installed and running; containers are the isolation boundary
- **Cloudflare tunnel required** — Connectivity to the platform depends on a Cloudflare tunnel (free tier available) for the outbound-only connection
- **Two-hour attempt ceiling** — Each individual attempt has a maximum runtime of two hours; long-running tasks must be broken into smaller issues
- **Log volume cap** — Log output is capped at 4MB per task; extremely verbose builds may see truncated output
- **Verification dependency** — Completion verification requires an available Gemini API; if the verifier is unreachable, the task fails rather than allowing unverified results through

---

_Part of [IntexuraOS](../overview.md) — your infrastructure, your rules._

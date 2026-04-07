# Orchestrator

Your code never leaves your machine — and no model ever verifies its own work.

## The Problem

Every AI coding agent on the market asks for the same thing: send us your code. Ship your repository to our servers, let our infrastructure run against it, and trust that nothing leaks, nothing persists, and nothing gets logged where it shouldn't. For a side project, maybe that trade is acceptable. For a company with compliance requirements, customer data baked into the repository, or proprietary algorithms refined over years — it is a non-starter. The moment your source code crosses the wire to someone else's infrastructure, you have lost a guarantee you cannot get back.

But keeping the code on your own hardware only solves half the problem. An AI agent that writes code and then declares its own work complete is an AI agent grading its own homework. The model that introduced a subtle bug is the same model telling you the bug does not exist. Self-assessment is not verification. It is a confidence score wearing a lab coat. And when you are running agents autonomously — no human watching every keystroke — that gap between confidence and correctness is where production incidents hide.

The orchestrator closes both gaps at once. It runs entirely on your infrastructure, so your source code never touches a third-party server. And it enforces a cross-model verification pipeline where the agent that writes the code is never the agent that judges the result. Claude or Codex executes. Gemini verifies. A separate compliance validator audits the full session transcript. Deterministic rules enforce what no model can be trusted to check. Multiple layers, multiple independent trust boundaries, one principle: no model verifies its own work.

## Use Case: From Idle Hardware to an Autonomous Engineering Team

Built for engineering teams who need autonomous coding agents but cannot — or will not — send their source code to someone else's infrastructure.

1. A startup CTO has a workstation sitting idle after an office move — a machine with Docker installed and nothing to do. She installs the orchestrator and connects it to IntexuraOS through a Cloudflare tunnel — an outbound-only encrypted connection. The machine never accepts inbound traffic from the internet.
2. A developer files a Linear issue describing a new API endpoint. The platform dispatches the task to her orchestrator, cryptographically signed to verify it came from IntexuraOS and has not been tampered with. The orchestrator validates the signature, checks that Docker is healthy and disk space is available, and accepts the work.
3. The orchestrator creates a dedicated copy of the repository on its own branch, then spins up a Docker container scoped to that workspace — locked down so it cannot see the host machine, cannot reach other containers, and cannot access any other task's files or credentials.
4. The Planning Agent analyzes the issue, reads all existing comments and context, makes an explicit complexity judgment, and produces a design — either enriching the issue directly or creating subtasks with a planning pull request. No code is committed yet. The orchestrator injects execution memories from past tasks — patterns, pitfalls, and verified approaches — so the agent does not repeat known mistakes.
5. The CTO watches logs stream to her dashboard in real time, flushed every three seconds. She sends a mid-task message clarifying a requirement, which the orchestrator queues and delivers when the current attempt finishes.
6. The Execution Agent writes tests first, implements the endpoint, runs the full test suite, performs a mandatory simplification pass on every changed file, executes a zero-tolerance code review loop, and opens a pull request — including which AI model produced the work.
7. Now the verification pipeline begins. **Stage one:** Gemini evaluates the agent's final output against an agent-specific contract, extracting structured metadata — PR URLs, skill usage proofs, outcome labels — and validating them against strict schemas. Claude's own assessment of its performance is not consulted. If the contract is not met and the attempt limit has not been reached, the orchestrator automatically launches a follow-up attempt with a targeted prompt listing exactly which criteria failed. All planned outcomes — including simple tasks — require an evidence PR to pass verification.
8. **Stage two:** An Agent Compliance Validator reads the full session transcript — every tool call, every edit, every decision — and performs a structured audit via an independent LLM (OpenRouter). The resulting compliance report covers claim verification (did the agent actually do what it said it did?), contract compliance (were mandatory skills invoked in the correct order?), and anomaly detection (fabrication, hallucination, protocol violations). This report is posted directly on the pull request with visual severity indicators, so reviewers see an independent, evidence-backed assessment before they read a single line of code.
9. **Stage three:** A Remediation Agent — triggered when the Review Agent identifies findings above a severity threshold — autonomously addresses review feedback on the existing PR branch, runs CI, and decides whether a re-review is needed. This auto-improvement loop can cross LLM boundaries, using different models to check each other's work.
10. **Stage four:** A separate code-agent service enforces deterministic rules — Linear issue mutations, label updates, status transitions — that no language model can be trusted to apply consistently.
11. The CTO reviews a clean pull request with an independent compliance report attached and a requirements audit confirming every plan item was addressed. Her source code never left the building.

## How It Helps

### Keep Your Code on Your Infrastructure

The orchestrator runs as a native process on your hardware. A server rack in your office, a cloud VM in your preferred region, a repurposed laptop — the requirements are Docker and a Cloudflare tunnel. Your source code stays on your machine. AI inference calls go directly from your hardware to the model provider. The only data that reaches IntexuraOS is task status, logs, and performance metrics. The platform sees an endpoint, not your codebase.

You can run one orchestrator or several, each on different hardware, each in a different location. The platform dispatches work to whichever has capacity. A sensitive file guard scans every commit against twenty-plus patterns — environment files, certificates, private keys, infrastructure state — and reverts anything that matches before results reach your repository. This matters because autonomous agents occasionally stage files they should not. The guard catches the mistake before it leaves your machine — a safety net that most self-hosted solutions lack entirely.

**Example:** A fintech company runs one orchestrator on a VM in Frankfurt for GDPR-sensitive repositories and another on a workstation in their New York office for US-based projects. Both appear as worker endpoints to the platform. The source code in each location never crosses the Atlantic. When a worker accidentally stages a `.env` file containing database credentials, the sensitive file guard catches it and reverts the file before the commit is pushed.

### Run Tasks Across Multiple AI Runtimes

The orchestrator supports twelve worker type presets spanning multiple AI providers and runtimes. Claude-backed types (auto, opus, sonnet) use Anthropic's models via OAuth. Third-party model types (minimax, glm, qwen, kimi, openrouter-free) route through MiniMax, Alibaba Cloud DashScope, or OpenRouter APIs. Codex-backed types (codex, codex-xhigh) use OpenAI's Codex runtime with ChatGPT device-auth. Each worker type carries its own API base URL, model identifier, and effort level — the orchestrator resolves the correct credentials, runtime adapter, and log processor automatically.

Codex tasks produce human-readable logs through a dedicated log processor that formats streaming output differently from Claude sessions. The orchestrator handles auth lifecycle independently for each runtime — Claude uses OAuth with automatic token refresh, Codex uses ChatGPT device-auth with periodic revalidation. Both auth states are exposed on the health endpoint so operators know at a glance which runtimes are ready.

**Example:** A team routes complex architectural tasks through `opus` (high-effort Claude) for its deep reasoning, uses `codex-xhigh` for tasks that benefit from Codex's code generation strengths, and falls back to `openrouter-free` for lightweight triage or zero-cost prototyping. All three run through the same orchestrator, same verification pipeline, same compliance checks — the worker type selection is the only difference.

### Verify Every Result with a Cross-Model Pipeline

This is the engineering decision at the heart of the system: the model that writes the code must never be the model that judges the result. Claude or Codex executes the task. Gemini evaluates whether the task was actually completed. An independent compliance validator audits the full session transcript. A deterministic enforcement layer handles what no model can be trusted to do consistently. Multiple independent trust boundaries, each checking the one before it.

The Completion Verifier sends the agent's final output to Gemini, which extracts structured metadata and validates it against agent-specific schemas — one for planning, one for execution, one for pull request work, one for code review, one for remediation, one for ask-agent. This is not a "looks good" check. It is structured data extraction with schema enforcement. If mandatory fields are missing or the contract is unmet, the task is automatically retried with a targeted prompt that names exactly which criteria failed. Fatal crashes — out-of-memory kills and segfaults — skip the Gemini call entirely and trigger an immediate retry, because there is no output to evaluate. All execution outcomes — including tasks where the agent determines the work was already completed — require an evidence PR URL.

The Agent Compliance Validator goes further. After the Completion Verifier passes, it reads the entire session transcript — every tool call, every file edit, every terminal command — and sends the full context to an independent LLM (via OpenRouter) for a structured audit. The resulting report covers claim verification (did the agent actually call `ci:tracked`? did a PR actually get created?), contract compliance (were mandatory skills invoked in the correct order?), execution metrics, and anomaly detection. This report is posted directly on the pull request as a formatted comment with four severity levels: critical, warning, minor, and pass. Reviewers see exactly where the agent's claims match the evidence and where they diverge, before they review a single line of code.

**Example:** A worker completes an API endpoint but skips the test suite. The Completion Verifier catches the missing coverage proof and triggers a second attempt with a prompt that says "test execution evidence was not found in your output." On the second attempt, the worker writes and runs the tests. The Completion Verifier confirms the contract is met. Then the Agent Compliance Validator analyzes the full transcript, confirms that both mandatory skills were invoked in the correct order, that the PR was genuinely created (not just claimed), and posts a clean report on the PR with green pass indicators across every category.

### Autonomously Fix Review Findings

When an automated review identifies issues above a severity threshold, the orchestrator dispatches a Remediation Agent to address the findings without waiting for a human. The Remediation Agent works on the existing PR branch — reading the review comments, implementing fixes, running CI, and deciding whether the changes warrant a re-review. This creates an autonomous auto-improvement loop: write, review, remediate, re-review — all before a human sees the pull request.

The remediation loop can cross LLM boundaries. The execution agent might use Claude, the review agent might use a different model, and the remediation agent fixes the issues found by the reviewer. Each step operates independently, preventing any single model from both creating and approving its own work.

**Example:** The Review Agent finds three issues in a pull request: a missing null check, an inconsistent variable name, and an unused import. The Remediation Agent addresses all three, pushes the fixes to the PR branch, runs CI, and requests a re-review. The second review comes back clean. The developer sees a pull request with zero open findings and a full audit trail showing what was found and how it was fixed.

### Learn from Past Executions

The Execution Memory Graph captures patterns, pitfalls, and verified approaches from completed tasks and injects them into future task prompts. When a new task arrives, the orchestrator retrieves relevant memories based on semantic similarity and includes them in the system prompt — along with mandatory acknowledgment and usage reporting requirements.

Each memory carries a type (implementation pattern, verification pattern, pitfall, decomposition pattern, planning decision, or review finding), a relevance score, conditions for when it applies, recommended actions, known anti-patterns to avoid, and verification criteria. The agent must explicitly acknowledge every memory it receives and report which ones it applied or rejected in its final output.

Memories are advisory, not authoritative. The agent is instructed to trust the current repository state and Linear issue content over any memory, and to ignore memories that do not match the task at hand. This prevents stale patterns from overriding current requirements while still giving the agent institutional knowledge that would otherwise be lost between tasks.

**Example:** A previous task discovered that a specific Firestore migration pattern causes index conflicts when run in parallel. That pitfall is captured as a memory. When a new task involves Firestore migrations, the orchestrator injects the memory with context: "When creating composite index migrations, use sequential naming to prevent index collision." The execution agent reads the memory, confirms it applies, uses sequential naming, and reports the memory ID in its final output.

### Ask Questions in Interactive Sessions

The Ask Agent provides interactive Claude Code sessions where users send questions and receive direct answers — no PR creation, no Linear issue management, just a code-aware conversation. Messages flow through the same orchestrator infrastructure (Docker isolation, log streaming, HMAC-signed dispatch) but skip the planning/execution ceremony entirely.

Ask Agent sessions skip the PR resume preamble that other agent types use, deliver messages directly without wrapper prompts, check for pending messages in the completion path, and prohibit the `AskUserQuestion` tool (since users communicate via the message endpoint). The completion verifier still validates the session, but the contract is lighter — no PR URL or outcome label is required.

**Example:** A developer wants to understand how a complex caching layer works before filing an implementation issue. She starts an Ask Agent session, sends "Explain the cache invalidation strategy in the user-service," and gets back a detailed answer grounded in the actual codebase — because the agent has the full repository mounted and can read the code. She follows up with two more questions, each delivered as messages to the running session, refining her understanding before writing the spec.

### Isolate Every Task in Its Own World

When a task arrives, the orchestrator creates a fresh copy of the repository on a dedicated branch. It then spawns a Docker container locked to that workspace. Each container runs as a non-root user with all Linux capabilities dropped except the minimum required for network operations. It gets its own mounted workspace, its own credentials directory (read-only), its own resource limits (eight gigabytes of memory, four CPU cores), and its own log stream. Two tasks running simultaneously never see each other's files, credentials, or output.

The default capacity is two concurrent tasks, configurable based on your hardware. A Docker health gate checks daemon availability and disk health before accepting new work. Container creation times out after two minutes to prevent hung dispatches. Git operations on the shared repository are serialized through a mutex to prevent index corruption when multiple tasks create or remove worktrees at the same time. Pull request containers are enforced to one preserved container per PR, preventing accumulation from retried tasks.

**Example:** Two developers file issues at the same time — one for a payment integration, another for a dashboard redesign. The orchestrator runs both concurrently in separate containers, each with its own mounted workspace and credentials. The payment task's API keys are invisible to the dashboard task. Neither worker can interfere with the other's branch, access the other's temporary files, or even detect the other's existence.

### Recover from Crashes Without Human Intervention

The orchestrator persists task state atomically to disk after every change — write to a temporary file, then rename. If the machine reboots, the process crashes, or Docker restarts, the orchestrator discovers running containers on startup and re-attaches to them, so tasks continue without interruption. If a container has exited or is unreachable, the platform is notified and the container is cleaned up. Stale containers left behind by previous runs are garbage-collected automatically through periodic cleanup.

When a task resume has been accepted but the orchestrator restarts before the worker is ready, the pending resume is recovered from persisted state and restarted automatically — no message is lost. The orchestrator also handles the case where a container has expired but the worktree still exists: it creates a fresh container on the existing worktree, allowing the session to continue.

Each attempt has a three-hour timeout — with a warning at two hours and fifty-five minutes and a hard kill at three hours — so a stuck task never occupies a worker indefinitely. Corrupted state files are backed up with a timestamp and a fresh state is initialized rather than crashing. The repository manager validates and sanitizes the local clone on every startup, syncing the local development branch with origin after fetch, stripping leaked credentials from remote URLs, and continuing gracefully when the network is temporarily unavailable. When forensics mode is enabled, the orchestrator captures crash snapshots and core dumps for failed containers, giving you diagnostic data without requiring you to reproduce the failure.

**Example:** A thunderstorm knocks out power to the office server running the orchestrator. When power returns and the machine reboots, the orchestrator starts up, discovers one still-running container and adopts it, detects one exited container and cleans it up, notifies the platform about an interrupted task, and resumes accepting new work — all without a human touching the keyboard. A pending resume that was accepted moments before the crash is automatically restarted.

### Watch Every Decision as It Happens

Logs stream back to the platform as they happen, flushed every three seconds, so you can watch a worker's progress from the dashboard as if you were sitting next to a colleague. Docker stream artifacts and terminal formatting codes are stripped automatically, and every line is timestamped. Per-task metrics — processing time, peak memory usage, AI token consumption, time spent waiting on API calls versus executing tools — flow back alongside the logs. You know exactly what each task costs and where the time went.

A heartbeat pings the platform every ten minutes. If the orchestrator goes silent, the platform knows immediately rather than waiting for a timeout. Mid-task messages let you inject clarifications or course corrections while work is in progress — the orchestrator queues the message and delivers it when the current attempt finishes, triggering a follow-up session with your feedback incorporated.

**Example:** A team lead watches the orchestrator work through a complex refactoring task. Forty minutes in, she notices the worker is heading down the wrong path. She sends a mid-task message with a clarification. The orchestrator queues it and delivers it when the current attempt finishes, triggering a follow-up with her feedback incorporated. Without real-time visibility, she would have discovered the problem only after reviewing a flawed pull request.

## Getting Connected

Install the orchestrator on any Unix machine with Docker, set up a Cloudflare tunnel, and point it at your IntexuraOS instance. The machine becomes a worker endpoint within minutes. Your code stays on your hardware from the first task onward.

## Key Benefits

- **Your code, your hardware** — Source code never leaves your network; outbound data is limited to task status, logs, and performance metrics
- **Cross-model trust boundary** — Claude or Codex writes the code, Gemini verifies the result, an independent LLM audits the full transcript, deterministic rules enforce what no model can be trusted to check — no model ever grades its own work
- **Twelve worker type presets** — Anthropic (auto, opus, sonnet), MiniMax, Alibaba Cloud DashScope (GLM, Qwen, Kimi), OpenRouter free tier, and Codex (standard and xhigh) — all through a single orchestrator
- **Autonomous remediation loop** — Review findings trigger automatic fix, re-review, and verification without human intervention, crossing LLM boundaries at each step
- **Execution memory** — Past patterns, pitfalls, and verified approaches are injected into future tasks, preventing repeated mistakes and building institutional knowledge
- **Interactive sessions** — Ask Agent provides direct code-aware Q&A without the overhead of planning or PR creation
- **Complete task isolation** — Each task gets its own branch, container, credentials, resource limits, and log stream with no cross-task visibility
- **Self-correcting execution** — Failed verification triggers automatic follow-up attempts with targeted prompts naming exactly which criteria were not met; fatal crashes trigger immediate retries
- **Crash-resilient by design** — Survives reboots, adopts running containers, recovers pending resumes, cleans up orphaned work, and handles expired containers with existing worktrees — all without manual intervention
- **Evidence-backed PR reports** — The Agent Compliance Report gives reviewers an independent audit of the agent's claims against the actual transcript, posted directly on the pull request before human review begins

## Limitations

- **Docker required** — The host machine must have Docker installed and running; containers are the isolation boundary, and there is no fallback
- **Cloudflare tunnel required** — Connectivity to the platform depends on a Cloudflare tunnel for the outbound-only connection
- **Three-hour attempt ceiling** — Each individual attempt has a maximum runtime of three hours; long-running tasks need to be broken into smaller issues
- **Gemini dependency** — Completion verification requires an available Gemini API key at startup; if the verifier is unreachable during a task, that task fails rather than allowing unverified results through
- **Log volume cap** — Log output is capped at four megabytes per task; extremely verbose builds may see truncated output
- **Linux metrics only** — Per-task CPU and memory metrics rely on Linux control groups; macOS hosts report zero values for resource consumption
- **OpenRouter dependency for compliance** — The Agent Compliance Validator requires an OpenRouter API key; without it, compliance validation is skipped (completion verification still runs)

---

_Part of [IntexuraOS](../overview.md) — your infrastructure, your rules, your verification pipeline._

# Orchestrator

Your coding workforce, running on your own hardware.

## The Problem

Most AI coding agents run your code on infrastructure you do not control. Your source leaves your network, executes on the vendor's servers, and you trust a third party with access to your entire codebase. For teams with security requirements or compliance constraints, this is disqualifying.

The alternative -- running coding agents on your own machines -- sounds simple but is not. Managing concurrent tasks in isolation, handling credentials, streaming logs, and recovering from crashes is real operational work. The orchestrator eliminates that work while keeping everything on your hardware.

## Use Case: Turning a Spare Machine Into a Worker Station

A development team wants autonomous coding agents to work on their codebase without sending source code to external infrastructure. They have a spare server, a workstation under a desk, or a cloud VM. They install the orchestrator, connect the machine to IntexuraOS through a secure Cloudflare tunnel (an outbound-only encrypted connection -- the machine never accepts inbound traffic from the internet), and it becomes a fully managed worker station. No shared databases, no complex networking, no vendor access to their source code.

## How It Helps

### Any Machine, Anywhere

The orchestrator is designed to be installed independently from the rest of IntexuraOS. It can run on a server in your office, a cloud VM in your preferred region, or a repurposed laptop. The only requirements are Docker and a Cloudflare tunnel. From the platform's perspective, your machine is just an endpoint -- no shared state, no databases, no co-located services. The only data that flows outbound is task logs and metrics. Your source code stays on your hardware.

### Isolated Workspaces for Every Task

When a coding task arrives, the orchestrator creates a dedicated copy of your repository on its own branch. It then spawns a Docker container scoped to that workspace, with its own credentials, its own resource limits, and its own log stream. Two tasks running simultaneously never interfere with each other. The default capacity is two concurrent tasks (configurable based on your hardware), each fully sandboxed.

### Two-Phase Execution

Tasks follow a deliberate two-phase workflow. In the design phase, the worker analyzes the project issue, enriches it with context, designs an approach, and adds labels -- but commits no code. In the execution phase, the worker writes code, runs tests, and creates a pull request on GitHub. This separation prevents the common failure mode of autonomous agents charging ahead with implementation before the approach is sound.

### Completion Verification

Unlike agents that self-report completion, the orchestrator runs an independent verifier after each attempt. Did the worker meet the completion criteria for its phase? Is there a pull request? Did the tests pass? If verification fails, the orchestrator automatically launches a follow-up attempt, up to a configurable limit. This catches the persistent problem of AI agents declaring "done" when the work is incomplete -- a trust layer that most autonomous coding tools lack entirely.

### Real-Time Visibility

Logs stream back to the platform as they happen, so you can watch a worker's progress from the dashboard. Per-task metrics -- processing time, memory usage, AI token consumption -- flow back alongside the logs, giving you full cost visibility per task. A regular check-in ensures the platform knows immediately if a worker goes silent, preventing stalled tasks from occupying capacity. You can also send instructions to a running task mid-execution, or resume a completed task with new context.

### Crash Recovery

The orchestrator persists task state to disk. If the machine reboots, the process crashes, or Docker restarts, the orchestrator detects interrupted tasks on startup and notifies the platform. Stale workspaces are cleaned up automatically. The system is designed to survive the messy reality of running on hardware you manage yourself.

## Key Benefits

- **Infrastructure sovereignty** -- Your code never leaves your network
- **Location-independent** -- Install on any Unix machine, connect via Cloudflare tunnel
- **No vendor lock-in** -- The only connection to IntexuraOS is a single outbound tunnel; your machines remain fully yours
- **Concurrent isolation** -- Each task gets its own branch, container, and credentials
- **Self-correcting** -- Automatic follow-up attempts when verification detects incomplete work
- **Crash-resilient** -- Survives restarts, cleans up after failures, notifies the platform

## Limitations

- Each orchestrator runs on a single machine -- designed for controlled, auditable execution rather than high-throughput parallelism
- Requires Docker installed and running on the host
- Requires a Cloudflare tunnel (free tier available) for connectivity to the platform
- Maximum two-hour runtime per individual attempt
- Log output capped at 4MB per task
- Completion verification requires an available AI service; if unavailable, the task fails rather than allowing unverified results

---

_Part of [IntexuraOS](../overview.md) -- your infrastructure, your rules._

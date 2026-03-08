# Claude Worker

A ready-to-go coding environment in a box — your credentials, your machine, your control.

## The Problem

Running an AI coding agent on your host machine is like handing a contractor the master key to every room in the building. The agent needs access to source code, credentials, and network resources to do meaningful work — but nothing stops it from wandering into production databases, reading secrets it does not need, or making network calls to internal services you never intended to expose.

Most managed platforms solve this by moving the problem off your machine entirely. They run the agent in their cloud, with their API keys, on their infrastructure. You gain convenience but surrender control. Your source code passes through third-party servers. Your API spend flows through someone else's account, with their rate limits and their audit trail. When something goes wrong — and with autonomous agents, things do go wrong — you have no way to inspect what the agent accessed, no way to replay its network calls, and no way to confirm that credentials were not logged somewhere you cannot reach.

What teams actually need is neither of these. Not a process running loose on the host machine, and not a black box in someone else's cloud. They need an environment that is powerful enough for real engineering work, contained enough that a misbehaving process cannot reach beyond the task at hand, and owned entirely by the people who operate it.

## Use Case: The Overnight Feature Build

A team lead who wants a complex feature implemented by morning — without babysitting the process.

1. The lead opens the IntexuraOS web dashboard — the browser-based interface for assigning tasks and monitoring progress — and assigns the task before leaving for the day. No one configures an environment, installs dependencies, or sets up credentials.
2. The system provisions a fresh, isolated environment automatically. It arrives with version control, package management, fast code search, infrastructure tooling, a browser for automated testing, documentation lookup, error tracking, and pre-installed Claude Code plugins — all installed and connected from the first command.
3. The agent begins working immediately. Project dependencies are installed at startup using a shared cache, so packages that any previous environment already downloaded are available in seconds rather than minutes. Environment variables are synced from GCP Secret Manager at container start, so the agent has access to every service credential it needs without manual configuration.
4. Logs stream back to the dashboard in real time. A teammate checking in over coffee can see exactly what the agent is doing, what tests it is running, and whether it has hit any problems.
5. Midway through, a test fails. The agent adjusts its approach and continues. If it stalls or hits the two-hour attempt limit, the system retries automatically — but the environment stays warm. Session history, installed packages, and prior reasoning carry forward, so the next attempt picks up where the last one left off.
6. If the agent crashes unexpectedly (e.g., a segfault in the Claude CLI), the system captures forensic data — core dumps, debug logs, session state, and stack traces — for post-mortem analysis, then retries automatically.
7. By morning, the only evidence of the work is a clean pull request. The environment has been destroyed — no leftover processes, no credentials lingering on disk, no container sitting idle.

## How It Helps

### Keeps Your Credentials on Your Machine

You can set spending caps, monitor usage in real time, and revoke access instantly if something looks wrong — because the agent runs under your team's own Anthropic subscription, managed by whoever administers your host machine. No usage appears on someone else's invoice. No audit trail lives in a vendor's log store.

This matters because autonomous agents can be expensive. When you control the subscription directly, you see exactly how much each task consumed and you can cut off a runaway task without filing a support ticket with a vendor.

**Example:** Your team's Anthropic account shows exactly how many tokens each task consumed. If a runaway task burns through an unusual amount, you see it in the same dashboard you already use — and you can cut it off without filing a ticket.

### Delivers a Complete Workstation, Ready on Arrival

Every environment arrives with tools for managing code history, installing dependencies, searching files across large codebases, processing structured data, creating pull requests, automating a browser, validating infrastructure configurations, and authenticating with cloud providers. Claude Code plugins for documentation lookup (Context7), error tracking (Sentry), browser automation (Playwright), commit attribution, PR review, and frontend design are pre-installed and configured before the agent writes its first line of code.

Project dependencies are installed automatically at startup. A shared package cache means the first environment pays the installation cost once, and every subsequent environment benefits. Environment variables are synced from GCP Secret Manager and loaded via direnv, so the agent has access to all service credentials without manual setup. A task that would take twenty minutes to set up by hand is ready in seconds.

**Example:** The agent needs to validate infrastructure settings, run a browser-based integration test, and then create a pull request — all in the same task. It does not install anything or configure any credentials. Every tool is already there.

### Isolates Each Task by Design

Each environment starts without administrator access and cannot escalate its privileges. The system that manages containers is not accessible from inside — the agent cannot provision new environments, inspect other running tasks, or interfere with the host machine's operations.

Network access is scoped to the public internet: package registries, source control, and external APIs are reachable. Private IP ranges, the host machine's local services, and cloud infrastructure metadata endpoints are blocked. The agent can pull a dependency from npm or call a public API, but it cannot probe the internal network or discover other workloads running on the same machine.

Each task gets its own isolated copy of the repository, so concurrent tasks cannot step on each other's work. A two-hour maximum per attempt prevents any single task from running indefinitely.

**Example:** Two tasks run simultaneously on the same machine. One is refactoring authentication logic; the other is building a new API endpoint. Each operates in its own copy of the codebase with its own resource allocation. Neither can see the other's work, read the other's secrets, or compete for the other's memory.

### Preserves Continuity Across Attempts

An "attempt" is a single run of the agent against a task. If the first try does not succeed — a test fails, a timeout is hit, or the approach needs rethinking — the system retries with a fresh strategy. But the environment stays warm. Installed packages persist. The agent's previous session is resumed, so it starts the next attempt with context about what it tried and why it failed — though long sessions may be summarized to fit within the model's context window.

This is the difference between a system that retries and a system that recovers. A naive retry discards everything and starts from scratch — reinstalling dependencies, re-reading the codebase, re-discovering the same dead ends. A recovery picks up where the last attempt left off, skips the work that already succeeded, and tries a different path through the parts that failed.

**Example:** The agent spends forty minutes on a task before hitting a test failure that forces a different approach. On the retry, it does not repeat those forty minutes of setup. Dependencies are already installed. The codebase is already indexed. The agent's session history shows what it tried and why it failed, so it starts the next attempt with that context intact.

### Captures Crash Forensics Automatically

When a Claude CLI process crashes (e.g., exit code 139 indicating a segfault), the system automatically collects diagnostic artifacts: core dumps, GDB stack traces, command timing logs, debug directory contents, session snapshots, and process metadata. These artifacts are written to a timestamped directory that survives container teardown, enabling post-mortem analysis without reproducing the crash.

**Example:** An overnight task hits a segfault in the Claude CLI binary. By morning, the forensics directory contains the core dump, a full GDB backtrace, and the Claude session state at the time of the crash. The team can diagnose the issue without guessing what happened.

### Cleans Up After Itself

When a task completes, the environment is destroyed. Temporary files, session state, credentials mounted during execution — all of it disappears. Nothing persists on disk between tasks unless it was committed and pushed to the repository.

This is not just tidiness. Ephemeral environments eliminate an entire category of security concerns. There are no stale credentials to rotate, no leftover files to audit, and no risk that one task's secrets leak into the next task's workspace. Any environment that has been running for more than twenty-four hours is automatically removed, even if the system that created it lost track of it.

**Example:** A task that required access to a sensitive API key finishes at 3 AM. By 3:01 AM, the environment is gone. The API key is no longer mounted anywhere on the machine. No one needs to remember to clean it up.

### Stays Current with Daily Rebuilds

The container image is rebuilt daily at 4 AM UTC via Cloud Build, automatically picking up the latest Claude CLI releases from Anthropic. The rebuild schedule targets the window after Anthropic's peak release hours (3-6 PM PST), so new CLI features and bug fixes are available to the next task without manual intervention.

**Example:** Anthropic releases a Claude CLI update at 5 PM PST on Tuesday. By Wednesday morning, every new task uses the updated CLI — no manual image build, no deployment step.

## Getting Started

Claude Worker runs as part of the IntexuraOS platform. When you assign a coding task through the dashboard, the system provisions and manages the environment automatically. There is nothing to install, configure, or maintain — the environment arrives ready to work and disappears when the work is done.

## Key Benefits

- **Zero-configuration startup** — the environment arrives fully provisioned with every tool, integration, plugin, and dependency pre-installed. No setup scripts, no interactive prompts.
- **Credentials stay on your machine** — your team's Anthropic subscription, your audit trail, your rate limits. Nothing leaves the premises.
- **Ephemeral by default** — when the task ends, the environment is destroyed. No persistent traces, no stale credentials, no cleanup checklists.
- **Shared dependency cache** — package installations persist across environments, so repeated builds skip minutes of redundant downloads.
- **Real-time visibility** — logs stream to the dashboard as the agent works, and a pull request appears when it finishes.
- **Multiple tasks at once, no interference** — concurrent tasks each run in their own isolated copy of the repository with their own resource allocation. The concurrency ceiling is configurable by whoever operates the host.
- **Crash resilience** — forensic data is captured automatically on crashes, and the system retries with session continuity.
- **Always up to date** — daily image rebuilds ensure the latest Claude CLI and toolchain are available without manual maintenance.

## Limitations

- **One task per environment** — each environment handles a single task. This is a deliberate isolation boundary, not a scaling constraint.
- **No access to private networks** — the agent can reach public endpoints but cannot probe internal services or private IP ranges. By design.
- **Credentials are accessible during execution** — secrets are mounted read-only and destroyed with the environment when the task ends, so there are no stale credentials to rotate. But while the task runs, the agent can read them.
- **Two-hour maximum per attempt** — individual attempts are capped. The system retries automatically, but each run has a hard ceiling.
- **No persistent storage** — anything not committed to version control or pushed to a remote is lost when the environment is destroyed.
- **Configurable concurrency** — the number of simultaneous environments is set by whoever operates the host (default 4). Additional tasks wait in the queue.

---

_Part of [IntexuraOS](../overview.md) — AI-native software delivery, from task to pull request._

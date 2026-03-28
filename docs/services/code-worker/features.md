# Code Worker

Every coding task gets a fully equipped, security-hardened development environment that self-destructs when the work is done.

## The Problem

Running an AI coding agent on your host machine is like handing a contractor the master key to every room in the building. The agent needs access to source code, credentials, and network resources to do meaningful work — but nothing stops it from wandering into production databases, reading secrets it does not need, or making network calls to internal services you never intended to expose. Most developers accept this risk because the alternative — manually provisioning isolated environments for every task — takes longer than doing the work themselves.

Most managed platforms solve this by moving the problem off your machine entirely. They run the agent in their cloud, with their API keys, on their infrastructure. Your source code passes through third-party servers. Your API spend flows through someone else's account, with their rate limits and their audit trail. When something goes wrong — and with autonomous agents, things do go wrong — you have no way to inspect what the agent accessed, no way to replay its network calls, and no way to confirm that credentials were not logged somewhere you cannot reach. Platforms like Devin, Cursor Background Agents, and Copilot Workspace all require this trade-off. The convenience is real. The control you give up is permanent.

Code Worker takes a fundamentally different position: the agent runs on your machine, inside your network, under your API keys — but it cannot touch anything beyond the single task it was assigned. Your source code never leaves your infrastructure. Your Claude and Codex auth, your rate limits, your audit trail. The security boundary is not a vendor's terms of service; it is a container you own and can inspect. Rebuilding this from scratch — the credential isolation, the network restrictions, the session continuity, the daily toolchain updates — is months of infrastructure work that cloud-only competitors cannot shortcut by changing a configuration flag.

This is also why Code Worker exists as a separate, purpose-built container image rather than a mode of the orchestrator process. The orchestrator manages tasks, dispatches work, and verifies results. The worker is the environment itself — the toolchain, the security perimeter, the ephemeral workspace. Splitting them at the image boundary means you can rebuild the coding environment daily (picking up the latest Claude/Codex tooling) without redeploying orchestration logic. You can run four environments simultaneously, each with its own repository copy and credential set, without them sharing a single byte of memory or state. And you can version, audit, and pin the exact image digest that ran any given task — something impossible when the environment is just a subprocess of the orchestrator.

## Use Case: The Overnight Feature Build

A team lead who wants a complex feature implemented by morning — without babysitting the process.

1. The lead opens the IntexuraOS dashboard and assigns the task before leaving for the day. No one configures an environment, installs dependencies, or sets up credentials.
2. The system provisions a fresh, isolated environment automatically. It arrives ready to write code, run tests, search codebases, validate infrastructure, automate a browser, create pull requests, and look up documentation — all connected and configured from the first command.
3. Environment variables are synced from GCP Secret Manager at container start. Project dependencies install automatically using a shared package cache, so packages that any previous environment already downloaded are available in seconds rather than minutes. The agent begins working immediately.
4. Logs stream back to the dashboard in real time. A teammate checking in over coffee can see exactly what the agent is doing, what tests it is running, and whether it has hit any problems.
5. Midway through, a test fails. The agent adjusts its approach and continues. If it stalls or hits the two-hour attempt limit, the system does not tear down the environment and start over. Instead, it retries inside the same running environment — session history, installed packages, and prior reasoning all carry forward. The next attempt picks up where the last one left off, already knowing what it tried and why it failed.
6. By morning, the only evidence of the work is a clean pull request. The environment has been destroyed — no leftover processes, no credentials lingering on disk, no container sitting idle. Everything ran on the team's own infrastructure, under their own API keys, with nothing sent to a third-party cloud.

## How It Helps

### Recovers Instead of Restarting — Session Continuity Across Failures

Most retry systems are amnesiacs. When an attempt fails — a test breaks, a timeout hits, the approach needs rethinking — they tear everything down and start from scratch. The agent reinstalls dependencies, re-reads the codebase, re-discovers the same dead ends, and burns through the same forty minutes of setup before it can try something new.

Code Worker does not restart. It recovers. The environment stays alive between attempts. The orchestrator triggers each retry as a new command inside the same running container, resuming the agent's previous session with full context about what it tried and why it failed. Installed packages persist. The codebase is already indexed. The session history is intact.

This is not a small optimization. It is the difference between an agent that takes three cold starts to solve a hard problem — each one burning setup time and API tokens — and an agent that accumulates knowledge across attempts, treating each failure as information rather than a reason to forget everything.

**Example:** The agent spends forty minutes on a task before hitting a test failure that forces a different approach. On the retry, it does not repeat those forty minutes of setup. Dependencies are already installed. The codebase is already indexed. The session history shows what it tried and why it failed, so the next attempt starts with that context intact.

### Runs on Your Infrastructure — Not in Someone Else's Cloud

Every environment runs on a machine you control, using provider credentials you own, behind a network perimeter you define. Your source code is never uploaded to a third-party service. Your Claude or Codex usage is yours — your rate limits, your usage dashboard, your billing. When you need to audit what the agent did, the logs are on your machine, the container image digest is in your registry, and the git history is in your repository.

This is not a philosophical preference. It is a structural advantage that cloud-hosted competitors cannot replicate without abandoning their business model. They need your code on their servers to run their agents. You do not need to send your code anywhere. The agent runs where the code already lives.

**Example:** Your company's security policy prohibits source code from leaving the corporate network. With cloud-hosted coding agents, that is a non-starter. With Code Worker, the agent runs on your own server or your development machine — the code never crosses a network boundary you do not control.

### Arrives Fully Equipped — Zero Setup, Zero Delay

Every environment ships with a complete developer toolchain: version control, package management, fast code search, infrastructure validation, browser automation for running end-to-end tests, the GitHub CLI for pull request workflows, and cloud authentication. Claude Code plugins and Codex skill tooling are pre-installed and configured before the agent writes its first line of code.

Project dependencies install automatically at startup. A shared package store means the first environment pays the installation cost once; every subsequent environment reuses the cached packages. Environment variables sync from a cloud secret store and load automatically, so the agent has access to every service credential without manual configuration. A task that would take twenty minutes to set up by hand is ready in seconds.

**Example:** The agent needs to validate Terraform configurations, run a Playwright browser test against a staging environment, and then create a pull request — all in the same task. It does not install anything or configure any credentials. Every tool is already there, every plugin is already connected.

### Isolates Every Task — Without Trusting the Agent to Behave

Each environment runs as a non-root user with no ability to gain elevated privileges or spawn new containers. The agent cannot provision new environments, inspect other running tasks, or interfere with the host. Dangerous network utilities are removed from the image entirely.

Network access is scoped to the public internet: package registries, source control, and external APIs are reachable. Private IP ranges, the host machine's local services, and the cloud metadata endpoint are all blocked via firewall rules. The agent can pull a dependency from a package registry or push to GitHub, but it cannot probe the internal network or discover other workloads running on the same machine. Each task gets its own isolated copy of the repository, so concurrent tasks cannot read each other's files, secrets, or session state.

The security model does not depend on the agent following rules. The restrictions are structural — enforced by the container runtime and network firewall, not by prompt instructions the agent could choose to ignore.

**Example:** Two tasks run simultaneously on the same machine. One is refactoring authentication logic; the other is building a new API endpoint. Each operates in its own copy of the codebase. Neither can see the other's work, read the other's secrets, or interfere with the other's processes. If one task goes haywire, the other is unaffected.

### Cleans Up After Itself — No Stale Credentials, No Lingering State

When a task completes, the environment is destroyed. Temporary files, session state, credentials mounted during execution — all of it disappears. Secrets are mounted read-only during the task and cease to exist when the container is removed. Nothing persists on disk between tasks unless it was committed and pushed to the repository.

This is not just tidiness. Ephemeral environments eliminate an entire category of security concerns. There are no stale credentials to rotate, no leftover files to audit, and no risk that one task's secrets leak into the next task's workspace. Idle and exited environments are cleaned up automatically through periodic garbage collection, so no container lingers past its usefulness.

**Example:** A task that required access to a sensitive API key finishes at 3 AM. By 3:01 AM, the environment is gone. The API key is no longer mounted anywhere on the machine. No one needs to remember to clean it up.

## Getting Started

Code Worker runs as part of the IntexuraOS platform. When you assign a coding task through the dashboard, the system provisions and manages the environment automatically. There is nothing to install, configure, or maintain — the environment arrives ready to work and disappears when the work is done.

## Key Benefits

- **Self-hosted by design** — the agent runs on your machine, under your API keys, behind your firewall. Source code never leaves your infrastructure. Cloud-hosted competitors cannot offer this without a fundamental architectural change.
- **Session continuity across retries** — when an attempt fails, the next one inherits the full session history, installed packages, and prior reasoning rather than starting cold. The agent accumulates knowledge instead of amnesia.
- **Ready from the first command** — the environment arrives with every tool, plugin, credential, and dependency pre-installed. No setup scripts, no interactive prompts, no waiting.
- **Ephemeral by default** — when the task ends, the environment is destroyed. No persistent traces, no stale credentials, no cleanup checklists.
- **Shared package cache** — the first environment installs dependencies once; every subsequent environment reuses them, cutting minutes off each startup.
- **Concurrent without interference** — multiple tasks run simultaneously in isolated copies of the repository, each with its own credential set and session state. The concurrency ceiling is configurable by whoever operates the host.

## Limitations

- **One task per environment** — each environment handles a single task. This is a deliberate isolation boundary, not a scaling constraint.
- **No private network access** — the agent can reach public endpoints but cannot access internal services, private IP ranges, or cloud metadata. By design.
- **Secrets are readable during execution** — credentials are mounted read-only and destroyed with the environment, but while the task runs, the agent can read them.
- **Two-hour cap per attempt** — individual attempts are time-limited. The system retries automatically with session continuity, but each run has a hard ceiling.
- **No persistent storage** — anything not committed to version control or pushed to a remote is lost when the environment is destroyed.
- **Configurable concurrency** — the number of simultaneous environments is set by whoever operates the host (default 4). Additional tasks queue until a slot opens.

---

_Part of [IntexuraOS](../overview.md) — AI-native software delivery, from task to pull request._

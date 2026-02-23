# Claude Worker

Your infrastructure, your credentials, your code -- an AI coding environment that never touches shared cloud resources.

## The Problem

Running an AI coding agent directly on your host machine exposes every credential, internal service, and piece of infrastructure to a process you cannot fully predict. Most managed platforms solve this by routing everything through their own cloud -- using their API keys, their compute, and their audit trails. You gain convenience but lose control: there is no way to know what the agent accessed, no way to enforce your own rate limits, and no way to keep sensitive credentials off a third party's servers.

What teams actually need is the opposite arrangement -- an environment powerful enough for real engineering work, isolated enough that a misbehaving process cannot reach beyond the task at hand, and owned entirely by the people who run it. Claude Worker provides exactly that: it runs Claude Code -- Anthropic's AI coding agent -- inside an isolated environment on your own machine.

## Use Case: The Overnight Feature Build

A team lead opens the platform dashboard and assigns a complex feature implementation before leaving for the day. The orchestrator -- the system that manages coding tasks -- provisions a fresh, isolated environment automatically. No one configures anything. The environment arrives with version control, package managers, infrastructure tooling, a browser for automated testing, documentation search, and error tracking already installed and connected. Dependencies are installed automatically at startup.

The agent begins working immediately. Logs stream back to the dashboard in real time, so anyone on the team can check progress. Midway through, a test fails. The agent adjusts its approach and continues. If the attempt stalls or hits its two-hour limit, the system retries with a fresh approach -- but the environment stays warm. Installed packages, session history, and prior context carry forward, so the next attempt picks up where the last one left off without repeating an hour of setup.

By morning, the only evidence of the work is a clean pull request. The environment has been cleaned up -- no leftover processes, no credentials lingering on disk.

## How It Helps

### Your Credentials Stay on Your Machine

The agent runs under your team's own Anthropic subscription -- managed by whoever administers the host machine, authenticated through a standard login. Credentials never leave the premises and never pass through a third-party cloud. Usage is auditable through Anthropic's own dashboard, and your team controls the spending and rate limits directly. You get the full capability of Claude Code without surrendering oversight.

### A Complete Workstation, Ready on Arrival

The environment ships with a full developer toolchain pre-installed: version control, package management, fast code search, infrastructure provisioning, cloud CLIs, and a browser for automated testing. Integrations for documentation lookup, error tracking, and browser automation are configured from the first command. If the project has dependencies, they are installed automatically at startup using a shared cache -- so the first environment pays the cost once, and every subsequent one benefits.

### Isolated by Design

Each environment starts without administrator access and cannot escalate it. The underlying system that manages these environments is not accessible from inside. Network access is designed to allow the public internet only -- enough to reach package registries, source control, and external APIs, but internal services, private networks, and other workloads on the same machine are blocked when the host is properly configured. The agent shares the host machine's resources alongside other workloads.

### Continuity Across Attempts

An "attempt" is a single run of the agent against a task. If the first try does not succeed -- a test fails, a timeout is hit, or the approach needs adjustment -- the system retries with a fresh strategy. The environment persists across these attempts: installed packages, session history, and working state all carry forward. The agent can resume a previous line of reasoning rather than starting from scratch.

## Key Benefits

- **Zero-configuration startup** -- the environment arrives fully provisioned, with no interactive setup required.
- **On-premises credential control** -- your team's subscription, your audit trail, your rate limits. Nothing leaves the machine.
- **Ephemeral by design** -- when the task ends, the environment is cleaned up, leaving no persistent traces on disk.
- **Shared dependency cache** -- package installations persist across environments, cutting minutes from repeated runs.
- **Real-time visibility** -- logs stream back to the dashboard as the agent works, and a pull request appears when it finishes.
- **Full internet access, scoped reach** -- the agent can pull packages and call public APIs; access to internal infrastructure is blocked when the host is properly configured.

## Limitations

- **One task per environment** -- a deliberate isolation boundary. Each environment is scoped to a single task, ensuring one piece of work cannot interfere with another.
- **No access to private networks** -- by design, the agent cannot reach internal services or databases behind firewalls. This prevents accidental exposure of infrastructure the agent was never meant to touch.
- **Credentials are accessible inside the environment** -- the agent needs credentials to authenticate against services like GitHub and cloud providers, so they are available during execution. They are stored separately and treated as read-only, but they are not hidden from the running process.
- **Two-hour maximum per attempt** -- individual attempts are capped to prevent runaway processes. Tasks that need more time are broken into multiple attempts, each building on the last.
- **No persistent storage** -- anything not committed to version control or pushed to an external service is lost when the environment shuts down. This is the tradeoff for true ephemerality.

---

_Part of [IntexuraOS](../overview.md) -- your infrastructure, your credentials, your code._

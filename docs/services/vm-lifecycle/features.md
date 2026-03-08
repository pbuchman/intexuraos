# VM Lifecycle

The infrastructure timekeeper for IntexuraOS — automated start and stop of the dedicated machine that runs AI coding agents, so it works when you work and sleeps when you sleep.

## The Problem

IntexuraOS runs its coding agents on a dedicated virtual machine. The orchestrator, the Claude Code workers, and the entire pipeline that turns requests into working code all live on a single cloud server. That server costs money every hour it runs, whether someone is using it or not.

Leave it on overnight, and you pay for an empty office. Leave it on over the weekend, and the bill compounds for 48 hours of silence. The obvious solution is to turn it off when nobody needs it. But "obvious" and "reliable" are different things.

Manual start and stop is a recipe for forgotten mornings and lost evenings. Forget to start it, and the first request of the day fails. Forget to stop it, and you pay for hours of idle compute. Worse, stopping a machine while a coding task is mid-flight — the agent halfway through implementing a feature, files partially written — risks corrupting work that took minutes of AI processing to produce.

What you need is a system that handles the schedule, verifies the machine is actually ready before declaring victory, and never pulls the plug on work in progress.

## Use Case: A Workday Without Thinking About Infrastructure

It is 6:58 AM on a Tuesday. You have not touched a terminal. You have not opened a dashboard. You are making coffee.

At 7:00 AM, the system sends a start command to the coding machine. The machine boots. The system does not just wait for the operating system to load — it keeps checking until the orchestrator and all coding agents report that they are ready to accept work. Only then does it consider the startup complete.

You sit down at your desk. Your first coding request goes through immediately. The machine was already warmed up and waiting.

At 11:00 PM, the nightly shutdown signal fires. But a coding task is still running — a complex refactor across multiple files. Instead of killing the machine, the system asks the orchestrator: "How many tasks are still running?" The answer comes back: one. So it waits. It checks again thirty seconds later. Still running. It keeps waiting, giving the task up to ten minutes to finish. The task completes at 11:04 PM. The system confirms zero active tasks, then powers down the machine.

You never knew any of this happened. Your work was preserved, and the machine stopped billing the moment it was no longer needed.

## How It Helps

### Starts That Actually Work

Turning on a virtual machine is not the same as having a working system. The machine can be "running" at the operating system level while the coding agents are still initializing, loading models, or recovering from a previous crash. A naive scheduler that fires a start command and walks away leaves you with a machine that looks alive but cannot do anything.

This system waits until the application layer — the orchestrator and the coding workers — reports ready. If the machine is already running but the application is unresponsive, the system restarts the machine entirely, then waits for a clean startup. The goal is not a running server. The goal is a server that can accept your first request of the day.

### Shutdowns That Protect Your Work

The shutdown sequence is where most automated systems fail. A cron job that runs "stop server" at 11 PM does not care whether something important is happening. This system does.

Before powering down, it notifies the orchestrator that a shutdown is coming. The orchestrator reports how many coding tasks are currently in progress. If the answer is zero, the machine stops immediately. If tasks are running, the system enters a ten-minute grace period — checking every thirty seconds, waiting for active work to finish. A complex coding task that started at 10:45 PM gets the time it needs to complete cleanly.

If the orchestrator becomes unresponsive during this process — perhaps it crashed, perhaps the network hiccuped — the system waits two minutes before proceeding with a forced shutdown. It does not wait forever, and it does not give up immediately. The balance between patience and pragmatism is deliberate.

### A Schedule You Do Not Manage

The machine starts every weekday morning and stops every night — including weekends, so a machine left running on Saturday still powers down automatically. No cron jobs to maintain, no scripts to remember, no calendar reminders to set. The schedule runs on its own, and each operation is safe to repeat — calling start on a running, healthy machine confirms it is fine and returns. Calling stop on an already-stopped machine does nothing. There is no penalty for redundancy.

## Key Benefits

- **Cost savings** — The machine runs only during business hours, eliminating overnight and weekend compute charges
- **Zero data loss** — Active coding tasks finish before the machine powers down, so no work is ever interrupted mid-flight
- **Self-healing startup** — A machine that is running but unresponsive gets automatically restarted rather than left in a broken state
- **Invisible operation** — The entire lifecycle runs without human intervention on weekdays, from morning boot to nightly shutdown

## Limitations

- **Single machine** — Manages one specific virtual machine instance, not a fleet
- **Fixed schedule** — The weekday start and nightly stop times are defined in infrastructure configuration and require a Terraform deployment to change
- **No weekend starts** — The machine does not start automatically on weekends; manual intervention is required for weekend work
- **Health endpoint dependency** — Startup verification relies on the application's health reporting; a misconfigured health check can cause false failures even when the machine is functioning

---

_Part of [IntexuraOS](../overview.md) — Automated infrastructure scheduling that saves money and never interrupts your work._

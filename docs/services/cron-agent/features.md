# Cron Agent

Automate recurring tasks across IntexuraOS services using natural language schedules and LLM-driven execution.

## The Problem

Recurring workflows in IntexuraOS require manual repetition. Users who want to run the same operation on a schedule — fetching daily reports, syncing data every hour, or triggering weekly cleanup jobs — must remember to do it themselves each time. There is no built-in way to define "do this every Monday at 9 AM" and have the system carry it out automatically.

## How It Helps

### Natural Language Scheduling

Describe when you want something to run in plain English. The service uses Gemini 2.5 Flash to convert descriptions like "every weekday at 9 AM" into precise cron expressions — no cron syntax knowledge required.

**Example:** You type "twice a day at 8am and 6pm" and the service generates the correct cron expression (`0 8,18 * * *`) with a human-readable summary confirming the schedule.

### LLM-Driven Action Execution

Each scheduled task runs as an autonomous agent that calls real service APIs via tool calling. The agent reads OpenAPI specs from target services, translates your instructions into concrete API calls, and executes them step by step.

**Example:** You create a schedule that says "fetch my open Linear issues and create a summary note." At the scheduled time, the agent discovers the available tools from linear-agent and notes-agent, calls the right endpoints, and produces a result.

### Full Execution History

Every execution is logged with tool call details, agent responses, token usage, and duration. You can review what happened, what tools were called, and whether the task succeeded or failed.

**Example:** After a scheduled job runs, you check the execution log and see it called `linear_agent__listIssues` (took 1200ms) then `notes_agent__createNote` (took 800ms), with the full agent summary of what was accomplished.

## Use Case

You want a daily standup prep note created every weekday morning. You create a schedule with the description "every weekday at 8:30 AM", select linear-agent and notes-agent as target services, and write the instruction: "List my open Linear issues assigned to me this sprint and create a note summarizing them by priority."

Each weekday at 8:30 AM, Cloud Scheduler triggers the cron tick. The cron-agent finds your schedule is due, spins up an LLM agent with tools from both services, and the agent fetches your issues and creates the summary note. You open IntexuraOS and find a fresh standup prep note waiting.

## Key Benefits

- Zero cron syntax knowledge needed — describe schedules in natural language
- Automated multi-service workflows that run without human intervention
- Complete audit trail with tool calls, costs, and agent reasoning for every execution
- Overlap protection prevents the same schedule from running concurrently

## Limitations

- Schedules cannot run more frequently than every 5 minutes (minimum interval enforced)
- Maximum of 50 schedules per user
- Each execution is limited to 10 tool-calling iterations
- Tool responses are truncated at 50KB to prevent context overflow
- The tick endpoint processes at most 100 due schedules per invocation — extremely high schedule density may defer some to the next tick

---

_Part of [IntexuraOS](../overview.md) — Automate your recurring workflows with natural language._

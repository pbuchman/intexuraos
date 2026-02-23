# Code Agent

From idea to pull request -- with a design review in between.

## The Problem

Most AI coding tools write code first and ask questions later. You describe what you want, and minutes later a pull request appears -- built on assumptions you never reviewed. If the approach was wrong, you find out during code review, after the work is already done.

The harder problem is not getting AI to write code. It is getting AI to write the *right* code -- and knowing before it starts whether it understood what you meant.

## Use Case: From Voice Note to Pull Request

You are driving when you realize the onboarding flow sends a confusing error message. You record a voice note on WhatsApp: "Fix the signup error -- when someone uses an email that already exists, tell them the account exists instead of showing a generic failure."

The code agent creates a project issue with a clear title, then produces a design: which file handles the signup flow, what the new error message should say, which tests need updating, and how it plans to verify the fix. You read the design over coffee the next morning. It looks right. You approve.

The agent writes the code on your own machine, runs the tests, and opens a pull request. A WhatsApp notification arrives with a link. You never opened a code editor.

## How It Helps

### Your Infrastructure, Your Code

Every line of code the agent writes is produced inside secure, isolated environments running on machines you configure and control. Your source code never leaves your infrastructure. The system supports up to two worker machines per user, with automatic fallback -- if the primary is occupied, the task routes to the secondary. You own the compute, you own the output.

### Two Phases, One Checkpoint

The code agent splits every task into two distinct phases. In the first, it interprets your request, creates a project issue, and produces a design -- an explanation of what it intends to build and how. Then it stops and waits. You review the design on your own schedule. If the approach looks right, you approve it. If not, you redirect. Only after your approval does the second phase begin: writing code, running tests, and opening a pull request. No code is written until you have seen and accepted the plan.

### Real-Time Visibility

While the agent works, a live terminal view in the web dashboard streams its progress as it happens. You always know where things stand -- and detailed metrics on processing time, memory, and AI usage are available for each step. Every task carries a unique tracking ID from submission through completion, so you can follow the full history of any piece of work.

### The Conversation Does Not End at the Pull Request

While a task is running, you can send it new instructions through the dashboard -- they are delivered at the next safe pause. After a pull request is open, the conversation keeps going: leave a review comment or mention the agent on the PR, and it picks up the feedback automatically, creating a follow-up task that carries forward the full context of the original work. You can also retry failed tasks with additional guidance, or resume completed ones to push further.

### Guardrails That Stay Out of the Way

Cost controls enforce per-user limits -- on concurrent tasks, hourly rate, and daily and monthly spend -- so you always know what the work costs. Tasks that go silent for thirty minutes are automatically interrupted. Notifications arrive on WhatsApp when a task starts, finishes, or fails, each with a link to the pull request or a button to cancel. A timeline view on the dashboard shows every PR event -- opens, pushes, reviews, comments -- with links back to the source.

## Key Benefits

- **Design before code** -- You approve the plan before a single line is written; no wasted work on wrong assumptions
- **Your machines, your code** -- Source code never leaves infrastructure you control
- **Responds to PR feedback** -- Review comments trigger automatic follow-up tasks with full context preserved
- **Submit from anywhere** -- WhatsApp voice note, typed message, or web dashboard -- every path leads to the same workflow
- **Predictable spend** -- Per-user limits on concurrency, daily and monthly cost, enforced in real time

## Limitations

- The design phase adds a deliberate pause -- teams that prefer fully autonomous execution will find this slower by design
- Limited to two worker machines per user
- A five-minute cooling period applies before retrying a failed task
- Mid-task messages are delivered at the next safe pause, not instantaneously
- WhatsApp notifications require a connected account

---

_Part of [IntexuraOS](../overview.md) -- describe what you want, come back to a pull request._

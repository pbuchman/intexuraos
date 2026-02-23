# Linear Agent

Speak your ideas, ship your issues.

## The Problem

You are in a meeting when a bug crosses your mind. You could open your project tracker, navigate to the right board, type a title, pick a priority, write a description. By the time you finish, you have missed three minutes of conversation and the issue says "fix login thing" with no detail.

The real cost is not the typing. It is the tradeoff: capture the thought carefully, or stay present. Most people choose presence, and the thought disappears.

## Use Case: The Voice Note That Writes Itself

You are driving home when you realize the onboarding flow breaks for users who sign up with an existing email. You hold down the microphone:

"Bug in onboarding. If someone signs up with an email already in the system, they get a generic error instead of being told the account exists. High priority -- affecting real signups."

By the time you park, the system has created a structured issue. The title is concise: "Show existing-account message during signup for duplicate emails." The priority is High, because you said so and the system understood. The description splits into what needs to happen and how it might be built. Your monologue became a specification a developer can pick up tomorrow without a clarifying question.

## How It Helps

### From Thought to Specification

Say what needs to be done -- in any language, as a voice note or typed message. The system extracts a clean, concise title, assigns a priority on a five-level scale, and generates a description split into what needs to happen and how it might be built. A rambling two-minute voice note becomes a structured spec. You do not need to organize your thoughts first.

### Priority That Reads Between the Lines

The system picks up on urgency the way a colleague would. Say "urgent" or "blocker" and the issue lands at the top of the board. Say "when you get a chance" or "nice to have" and it files itself as low priority. No dropdowns. Speak naturally, and the right level follows.

### A Board That Loads Before You Blink

Issues appear in three columns -- Planning (backlog and to-do), Work (in progress, in review, ready to test), and Closed (completed in the last seven days). Parent issues show sub-issues nested beneath them. Labels with colors appear on every card.

What makes the board fast is what happens behind it. Every change in Linear arrives automatically and is stored locally. The dashboard reads from that local copy, not from Linear's servers -- so it loads instantly, even for large workspaces with hundreds of issues. A background check runs periodically to catch anything an automatic update might have missed.

### Issue Details Without Leaving

Open any issue to see its full description, comments with author names and formatted text, and a last-activity timestamp -- without switching to Linear.

### Your Code Agent Updates the Board

When IntexuraOS writes code on your behalf, it also manages the board. A code task that started from a voice note can create sub-issues as the work progresses, move them from "in progress" to "in review" as milestones are reached, and keep the board reflecting reality without you touching it. The system verifies that parent issues exist before creating children, and if it cannot generate a good title, it stops and tells you rather than creating a misleading one.

## Key Benefits

- Capture ideas by voice or text in any language -- no forms, no field-picking, no app-switching
- Every issue arrives structured, not as a placeholder someone has to expand later
- Priority is inferred from how you speak, not from a dropdown you forget to set
- The dashboard loads from a local copy kept current automatically, with periodic background checks
- Parent-child relationships, labels, and comment counts visible at a glance
- Duplicate messages produce one issue, not two -- retries and double-taps handled silently
- Failed extractions saved for retry or dismissal, so nothing is lost
- When the system writes code for you, it updates the board automatically as work progresses

## Limitations

- Requires connecting a Linear account and selecting a team during initial setup
- Messages describing multiple issues may produce only the primary one
- Priority detection relies on explicit cues -- a neutral tone defaults to normal priority
- Input is capped at four thousand characters per message
- Voice note accuracy depends on transcription quality
- Labels are not yet applied when issues are created automatically

---

_Part of [IntexuraOS](../overview.md) -- your project tracker, driven by your voice._

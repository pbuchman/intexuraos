# Linear Agent

Speak your ideas, ship your issues. Turn voice notes and quick thoughts into structured, prioritized issues in Linear — the project tracker your engineering team already uses.

## The Problem

You are in a meeting when a bug crosses your mind. You could open Linear, navigate to the right board, type a title, pick a priority, write a description. By the time you finish, you have missed three minutes of conversation and the issue says "fix login thing" with no detail.

The real cost is not the typing. It is the tradeoff: capture the thought carefully, or stay present. Most people choose presence, and the thought disappears.

Then there is the board itself. You open your project dashboard and wait. The round trip to Linear's servers adds friction you feel every single time. Over a day of checking in on your team's work, those seconds compound into minutes of staring at loading states. The same agent that structures your spoken thought also keeps a local replica of your board — so the friction is gone end to end, from capture to visibility.

## Use Case: The Voice Note That Becomes a Specification

A product lead driving home from a client demo. She noticed the onboarding flow broke for users who skipped the company name field.

1. She holds the record button and says: "The onboarding wizard crashes when a user skips the company name on step two. This is high priority — we have a demo next Tuesday. The form should treat company name as optional and let users proceed. Probably need to update the validation schema and add a fallback in the display component."

2. She sends the voice note through WhatsApp. IntexuraOS transcribes it and routes it to the Linear Agent, which parses it into structured parts: a title ("Onboarding wizard crashes when company name is skipped"), a priority (High — she said "high priority"), a section describing what should happen ("Form should treat company name as optional and allow users to proceed past step two"), and a section describing how it might be built ("Update validation schema to make company name optional; add fallback in display component").

3. A Linear issue appears on her board, properly prioritized, with a description her engineering team can act on without asking clarifying questions. She never left the road.

## How It Helps

### Turn Natural Language into Structured Issues

You describe what is wrong and what needs to happen. The agent extracts a concise title (kept under 100 characters so nothing gets truncated in your board view) and splits your description into two sections your team actually needs: what should happen and how it might be built. The separation matters because product managers and engineers read different parts of an issue — one group cares about the behavior, the other about the implementation.

If you send the same message twice — because your phone glitched, because you were not sure it went through — the agent creates one issue, not two. Every input is tracked so duplicates are caught before they clutter your board.

**Example:** You say "Users can't upload files larger than 10MB, we need to bump the limit to 50MB, probably need to update the nginx config and the client-side validation." The agent creates an issue titled "Increase file upload limit from 10MB to 50MB" — the "what should happen" section describes the new limit behavior, and the "how it might be built" section points to nginx config and client-side validation changes.

### Read Urgency Between the Lines

You do not need to remember your project tracker's priority levels. The agent listens for urgency cues in your language and maps them to a five-level priority scale. Say "this is urgent" or "we need this ASAP" and the issue lands as Urgent. Mention "high priority" or "important" and it gets marked High. Casual requests default to Normal. Say "when you have time" or "nice to have" and it drops to Low.

This means your issues arrive pre-triaged. Your team sees what matters most without someone manually sorting the backlog every morning.

**Example:** You send "nice to have — add dark mode to the settings page." The agent creates the issue with Low priority. Later that day, you send "the payment webhook is dropping events, this is urgent." That issue arrives as Urgent. Both land on the board in the right order without anyone touching a priority dropdown.

### Load Your Board Before You Blink

The dashboard does not call Linear's servers when you open it. Instead, it reads from a server-side replica of your board that updates automatically whenever anything changes in Linear. When someone on your team moves an issue from "In Progress" to "In Review," that change arrives within seconds — without anyone refreshing a page.

Your issues appear organized into three column groups: Planning (backlog and todo items), Work (in progress, in review, and ready to test), and Closed (anything completed or cancelled in the last seven days). Within each column, the most recently updated issues appear first. Parent issues display their sub-issues nested underneath, so you can see an epic and the tasks inside it in one glance.

If the replica ever drifts — a missed update, a network hiccup — you can trigger a full refresh that pulls every issue from Linear, updates the local store, and removes anything that no longer exists. This also runs on a schedule automatically.

**Example:** Your team has a planning session and moves twelve issues from Backlog to In Progress. You open the dashboard a moment later and all twelve appear in the Work column, sorted by the most recently touched. No loading spinner, no stale data from five minutes ago.

### See Issue Details Without Leaving

Click into any issue and you get the full picture: the complete description, every comment with author names and markdown formatting, and the timestamp of the last activity. Comments are paginated so even long-running issues with dozens of replies load quickly. You see the comment count at a glance before deciding whether to dive in.

This means you can triage, review, and respond to issues from one place. You do not need to open Linear in a separate tab to read the discussion thread.

**Example:** A developer comments on an issue asking whether the fix should be backward-compatible. You see the comment, the developer's name, and the full context of the issue description — all without switching applications. You reply from where you are.

### Let Your Code Agent Update the Board

When IntexuraOS's code agent — the part of the system that writes code on your behalf — finishes work, it updates your Linear board directly. It creates sub-issues when implementation breaks into smaller pieces, and it moves workflow states as work progresses. The board reflects what your automated tools have done, not just what humans have touched.

This closes a loop that most teams leave open: the code gets written, the pull request gets merged, but the issue still says "In Progress" because nobody remembered to drag it across the board.

**Example:** The code agent picks up an issue to refactor the authentication module. It creates three sub-issues — one for token validation, one for session management, one for logout flow — and moves each to "In Progress" as it starts working. When it finishes, the parent issue's children show the full breakdown of what was done.

### Generate Titles from Descriptions

Sometimes you have a detailed description but no concise title. The agent generates one for you — kept under 80 characters — from whatever description text you provide. If the title generation fails, you get an error back immediately rather than a silent guess.

**Example:** You paste a three-paragraph bug report. The agent returns "PDF export drops images when document contains mixed media types" — a title that fits in your board column and tells the team exactly what to expect.

## Getting Connected

You connect your Linear account by providing an API key and selecting which team the agent should work with. A webhook secret is configured separately to keep your board's local copy in sync with changes made in Linear.

## Key Benefits

- **Voice capture** — Speak a thought and get a structured issue, not a half-formed reminder
- **Intelligent prioritization** — Your words set the priority level automatically, no dropdown menus required
- **Split descriptions** — What should happen and how it might be built, separated so product and engineering each find what they need
- **Instant dashboard** — Board loads from a server-side replica kept current automatically, so you never wait for a round trip to Linear
- **Parent-child visibility** — Epics and the tasks inside them nested together in one view with labeled columns
- **Duplicate protection** — Send the same message twice and get one issue, not two
- **Failed extraction recovery** — If parsing fails, the input is saved for manual review, retry, or dismissal rather than lost
- **Automated board updates** — The code agent creates sub-issues and moves workflow states so your board stays current with actual work

## Limitations

- **Built for Linear** — Deep integration with Linear's data model, workflow states, and change events; no support for Jira, Asana, or other project trackers
- **One issue per message** — Each input creates a single issue; bundling multiple bugs into one message produces one combined issue rather than separate entries
- **Priority detection is keyword-based** — The agent recognizes phrases like "urgent" or "nice to have" but may not catch every way you express urgency; you can always adjust priority manually in Linear
- **Input length cap** — Messages are limited to 4,000 characters; longer descriptions need to be split or trimmed before sending
- **Voice note quality** — Transcription accuracy depends on your recording environment; unclear audio may produce garbled issues
- **No automatic labels** — Issues created through the agent do not receive labels automatically; you add them after the fact in Linear

---

_Part of [IntexuraOS](../overview.md) — your project tracker, driven by your voice._

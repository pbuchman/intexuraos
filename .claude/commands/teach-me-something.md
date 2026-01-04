# Teach Me Something

Share an interesting tech insight and log it for future reference.

**IMPORTANT: Always write content in English, regardless of the conversation language.**

**Usage:**

- `/teach-me-something` — pick topic from recent context or trending tech
- `/teach-me-something [topic]` — teach about specific topic (e.g., `/teach-me-something token exchange`)

## Step 1: Choose a Topic

**Priority order:**

1. If user provided a topic argument → teach about that (use WebSearch if needed for depth)
2. If interesting patterns, architecture decisions, or techniques were discussed recently → teach about that
3. Otherwise → use WebSearch for trending tech/AI topics (current year)

Prioritize topics that are:

- Practical and applicable
- Not too basic (assume intermediate developer knowledge)
- Related to: distributed systems, cloud architecture, TypeScript/Node.js, AI/ML, DevOps, security

## Step 2: Teach (Immediate)

Present the insight directly in chat using this format:

```
★ Insight ─────────────────────────────────────
**[Topic Title]**

[2-4 key educational points with clear explanations and examples where helpful]

Sources:
- [Source Title 1](url)
- [Source Title 2](url)
─────────────────────────────────────────────────
```

If teaching from recent context, no web sources needed.
If teaching from web search, include 1-3 relevant sources.

## Step 3: Log to Repository (Background)

After presenting the insight, spawn a background agent using the Task tool:

```
Task tool parameters:
- subagent_type: "general-purpose"
- run_in_background: true
- prompt: |
    Create a markdown file documenting what was just taught.

    Topic: [TOPIC_TITLE]
    Context: [BRIEF_DESCRIPTION_OF_WHAT_USER_WAS_BUILDING - 1-2 sentences]
    Content: [FULL_EXPLANATION_FROM_STEP_2]
    Sources: [LIST_OF_SOURCES_IF_ANY]

    Steps:
    1. Create file: ~/personal/teach-me-something/YYYY-MM-DD-[topic-slug].md
       - Use today's date
       - Slug: lowercase, hyphens, max 50 chars

    2. File content format:
       # [Topic Title]

       *Learned: YYYY-MM-DD*

       ## Context

       [What I was building when I learned this - helps trigger memory later]

       ## Insight

       [Full explanation]

       ## Sources

       - [Title](url)

    3. Git operations:
       cd ~/personal/teach-me-something
       git add .
       git commit -m "Add: [topic-slug]"
       git push
```

Do NOT wait for the background task to complete. Continue conversation immediately after spawning.

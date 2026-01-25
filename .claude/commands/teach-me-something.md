# Teach Me Something

Share an interesting tech insight and log it for future reference.

**IMPORTANT: Always write content in English, regardless of the conversation language.**

**Usage:**

- `/teach-me-something` — pick topic from recent context or Threads/ClaudeCode community
- `/teach-me-something [topic]` — teach about specific topic

---

## Step 1: Check for Duplicates

**MANDATORY:** Before selecting a topic, check existing insights to avoid duplicates:

```bash
ls -t ~/personal/teach-me-something/*.md | head -20
```

Note the recent topics from filenames (format: `YYYY-MM-DD-topic-slug.md`). Do NOT teach about topics already covered.

---

## Step 2: Choose a Topic

**Priority order:**

1. If user provided a topic argument → teach about that (use WebSearch if needed for depth)
2. If interesting patterns, architecture decisions, or techniques were discussed recently → teach about that
3. Otherwise → search for trending ClaudeCode topics:

**ClaudeCode Community Search:**

```
WebFetch: https://www.threads.com/search?q=ClaudeCode&serp_type=default
Prompt: "Extract the most interesting technical insights, tips, or discoveries about Claude Code from the last few posts. Focus on practical techniques, workflows, or features. List 3-5 topics with brief descriptions."
```

Then pick the most interesting topic that:
- Is NOT already in `~/personal/teach-me-something/`
- Is practical and applicable
- Relates to: AI coding assistants, prompt engineering, developer workflows, TypeScript/Node.js

**Good topics:**

- Practical and applicable
- Not too basic (assume intermediate developer knowledge)
- Related to: distributed systems, cloud architecture, TypeScript/Node.js, AI/ML, DevOps, security
- Specific patterns or techniques from the current codebase

---

## Step 3: Teach (Immediate)

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

---

## Step 4: Log to Repository (Background)

After presenting the insight, spawn a background agent using the Task tool:

```
Task tool parameters:
- subagent_type: "general-purpose"
- run_in_background: true
- prompt: |
    Create a markdown file documenting what was just taught.

    Topic: [TOPIC_TITLE]
    Context: [BRIEF_DESCRIPTION_OF_WHAT_USER_WAS_BUILDING - 1-2 sentences]
    Content: [FULL_EXPLANATION_FROM_STEP_3]
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

---

## Step 5: Suggest Next Steps

After presenting the insight:

```
💡 **Related Explorations:**
- [Related topic 1 to explore next]
- [Related topic 2 to explore next]
- [How this applies to current work]
```

---

## Example Flow

**User:** `/teach-me-something`

**Assistant:**

1. Lists recent files in `~/personal/teach-me-something/` → sees `2026-01-20-subpath-exports.md`
2. Checks recent context → nothing particularly interesting
3. Fetches Threads ClaudeCode search → finds tip about "using hooks for automated testing"
4. Verifies "hooks-automated-testing" not in existing files
5. Presents insight on Claude Code hooks
6. Spawns background agent to persist
7. Suggests related explorations

---

## Topic Ideas by Category

| Category                | Example Topics                                        |
| ----------------------- | ----------------------------------------------------- |
| **Distributed Systems** | CAP theorem trade-offs, saga patterns, event sourcing |
| **Cloud Architecture**  | Service mesh, serverless cold starts, multi-region    |
| **TypeScript**          | Branded types, conditional types, type narrowing      |
| **AI/ML**               | Prompt engineering, RAG patterns, model selection     |
| **DevOps**              | GitOps, progressive delivery, observability           |
| **Security**            | OWASP patterns, secrets management, zero trust        |
| **Claude Code**         | Hooks, MCP servers, skills, custom agents             |

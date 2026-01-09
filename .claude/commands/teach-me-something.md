# Teach Me Something

Share an interesting tech insight and persist it for future reference using claude-mem.

**Usage:**

- `/teach-me-something` — pick topic from recent context or trending tech
- `/teach-me-something [topic]` — teach about specific topic

---

## Step 1: Choose a Topic

**Priority order:**

1. If user provided a topic argument → teach about that (use WebSearch if needed for depth)
2. If interesting patterns, architecture decisions, or techniques were discussed recently → teach about that
3. Otherwise → use WebSearch for trending tech/AI topics (current year)

**Good topics:**

- Practical and applicable
- Not too basic (assume intermediate developer knowledge)
- Related to: distributed systems, cloud architecture, TypeScript/Node.js, AI/ML, DevOps, security
- Specific patterns or techniques from the current codebase

---

## Step 2: Check for Prior Knowledge

Before teaching, search memory for related insights:

```
Use mcp__plugin_claude-mem_mcp-search__search with:
- query: "[topic]"
- type: "discovery" or "decision"
- limit: 5
```

If related insights exist:

- Reference them in your teaching ("Building on what we learned about X...")
- Avoid repeating the same insight
- Focus on new angles or deeper exploration

---

## Step 3: Present the Insight

Use this format:

```
★ Insight ─────────────────────────────────────
**[Topic Title]**

[2-4 key educational points with clear explanations]

[Code examples if applicable]

[Practical application in this project]

Sources: (if from web search)
- [Source Title](url)
─────────────────────────────────────────────────
```

**Guidelines:**

- Make it actionable, not just theoretical
- Connect to the current codebase when possible
- Include code snippets for programming concepts
- Keep it concise but complete

---

## Step 4: Persist to Memory

**MANDATORY:** Store the insight using claude-mem for future reference.

The insight should be stored as an observation that future sessions can reference:

```
Store observation with:
- Type: discovery
- Title: "Learned: [Topic Title]"
- Content: Full insight content including:
  - Key points
  - Code examples
  - Sources
  - Context (what prompted this learning)
- Project: intexuraos (if relevant to project)
```

**Why persist:**

1. **Continuity** — Future sessions can build on this knowledge
2. **Pattern Recognition** — Similar questions trigger related insights
3. **Personal Knowledge Base** — Accumulated learnings accessible anytime
4. **Context Awareness** — AI understands what you've already learned

---

## Step 5: Suggest Next Steps

After presenting and persisting:

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

1. Checks recent context → sees discussion about Pub/Sub patterns
2. Searches memory → no prior insights on "dead letter queues"
3. Presents insight on DLQ patterns with GCP Pub/Sub examples
4. Persists to memory with `discovery` type
5. Suggests: "Consider: exponential backoff, poison message detection"

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

---

## Memory Integration

This skill uses claude-mem MCP for persistence:

| Action                     | Tool                                                  |
| -------------------------- | ----------------------------------------------------- |
| Search existing insights   | `mcp__plugin_claude-mem_mcp-search__search`           |
| Get context around insight | `mcp__plugin_claude-mem_mcp-search__timeline`         |
| Fetch full details         | `mcp__plugin_claude-mem_mcp-search__get_observations` |

**Note:** Storing observations happens automatically through the conversation - insights shared become part of the memory context.

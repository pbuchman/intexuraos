# Hellscript Agent

Turn scattered thoughts into polished drafts — speak your ideas, get a structured document.

## The Problem

Writing is hard when your thoughts arrive out of order. You have fragments of ideas, scattered notes, and half-formed paragraphs, but turning them into a coherent document requires sitting down and organizing everything manually. Traditional writing tools expect you to compose linearly, which does not match how most people actually think.

## How It Helps

### Capture Thoughts Naturally

Send any thought, in any order. The Hellscript Agent accumulates your ideas into a structured buffer without requiring you to organize them yourself.

**Example:** You remember a key point for your blog post while reviewing something else. Send "the main advantage is reduced latency" — it joins your other thoughts, ready to be woven into the final draft.

### AI-Powered Intent Interpretation

The system understands what you mean, not just what you say. Gemini 2.5 Flash interprets each utterance to determine whether you are adding a thought, providing a writing sample, setting style preferences, or requesting a draft.

**Example:** Say "write it in a casual tone, like I'm talking to a friend" — the agent recognizes this as a style instruction and stores it separately from your content thoughts.

### Draft Generation from Accumulated State

When you are ready, request a draft and the agent synthesizes all your thoughts, writing samples, style instructions, and metadata into a coherent markdown document. Each draft is versioned, so you can iterate without losing previous versions.

**Example:** After capturing 10 thoughts about a product announcement, say "write the draft" — the agent produces a structured markdown document that incorporates everything you have shared.

### Buffer Workspace View

View the full state of your writing project at a glance: all captured thoughts, event history, draft versions, and the current materialized state. The web UI provides a conversation-style interface with a timeline, draft pane, and version selector.

**Example:** Open your buffer workspace to review which thoughts are included, reorder them, delete irrelevant ones, and compare draft versions side by side.

## Use Case

You are preparing a technical blog post. Over the course of a day, you send the Hellscript Agent a series of thoughts: "event sourcing reduces coupling," "include a diagram showing the pipeline," "mention the 3x throughput improvement." You also paste a paragraph from a previous post as a writing sample and specify "audience: senior engineers." When you are ready, you say "write the draft." The agent interprets your request, synthesizes your 8 accumulated thoughts with the style context, and generates a structured markdown document. You review it, add one more thought, and request a second draft — version 2 refines the previous output with the new material.

## Key Benefits

- Capture ideas as they come without context-switching to a writing tool
- AI interprets intent so you do not need structured commands
- Every draft is versioned — iterate freely without losing previous work
- Materialized state tracks thoughts, samples, style, audience, and content goals in one place
- Graceful degradation — if the LLM cannot interpret an utterance, it falls back to appending a thought

## Limitations

- Utterance length is capped at 10,000 characters per impose request
- Buffer ID length is limited to 128 characters
- Draft generation depends on Gemini 2.5 Flash availability — if the LLM call fails, the intent is still recorded but the draft is not produced
- No collaborative editing — each buffer belongs to a single authenticated user
- No export formats beyond markdown

---

_Part of [IntexuraOS](../overview.md) — Think freely, write later._

# Hellscript Agent

Turn scattered thoughts into polished drafts — speak your ideas, get a structured document tailored to the platform you are writing for.

## The Problem

Writing is hard when your thoughts arrive out of order. You have fragments of ideas, scattered notes, and half-formed paragraphs, but turning them into a coherent document requires sitting down and organizing everything manually. Traditional writing tools expect you to compose linearly, which does not match how most people actually think. Worse, you write differently for Threads than you do for LinkedIn or a blog post, but most tools force you to apply that style manually every time.

## How It Helps

### Capture Thoughts Naturally

Send any thought, in any order. The Hellscript Agent accumulates your ideas into a structured buffer without requiring you to organize them yourself.

**Example:** You remember a key point for your blog post while reviewing something else. Send "the main advantage is reduced latency" — it joins your other thoughts, ready to be woven into the final draft.

### AI-Powered Intent Interpretation

The system understands what you mean, not just what you say. Gemini 2.5 Flash interprets each utterance to determine whether you are adding a thought, deleting one, reordering your outline, or requesting a draft.

**Example:** Say "move the conclusion point to the top" — the agent recognizes this as a reorder operation and restructures your thought list accordingly.

### Categorized Writing Configuration

Define your voice separately for each platform you write for. Set style instructions and upload writing samples per category — Threads, LinkedIn, or General — so each draft matches the tone, length, and conventions of its target platform.

**Example:** Your LinkedIn style says "professional but conversational, 1200-word posts with clear section headers." Your Threads style says "punchy, opinionated, max 500 characters." The agent applies the right configuration automatically when you generate a draft for either platform.

### Draft Generation from Accumulated State

When you are ready, request a draft and the agent synthesizes all your thoughts, style instructions, and writing samples into a coherent markdown document. Each draft is versioned, so you can iterate without losing previous versions. The agent considers your prior draft when generating updates, building on what already works.

**Example:** After capturing 10 thoughts about a product announcement, say "write the draft for LinkedIn" — the agent produces a structured markdown document incorporating everything you have shared, styled to match your LinkedIn voice.

### Buffer Workspace View

View the full state of your writing project at a glance: all captured thoughts, event history, draft versions, and the current materialized state.

**Example:** Open your buffer workspace to review which thoughts are included, reorder them, delete irrelevant ones, and compare draft versions side by side.

## Use Case

You are preparing content about a technical topic and plan to publish on both LinkedIn and Threads. Over the course of a day, you send the Hellscript Agent a series of thoughts: "event sourcing reduces coupling," "include a diagram showing the pipeline," "mention the 3x throughput improvement." You have already configured your LinkedIn style to be "professional and detailed" with a writing sample from a previous post, and your Threads style to be "short, punchy hot takes."

When you are ready, you say "write the draft" and select LinkedIn as the category. The agent generates a structured, professional markdown document incorporating all 3 thoughts with your LinkedIn voice. Later, you request a Threads draft from the same buffer — the agent produces a concise, high-energy version of the same material. Both drafts are versioned, and you can iterate on either independently.

## Key Benefits

- Capture ideas as they come without context-switching to a writing tool
- AI interprets intent so you do not need structured commands
- Platform-specific style configuration produces drafts that match each audience
- Every draft is versioned — iterate freely without losing previous work
- Graceful degradation — if the LLM cannot interpret an utterance, it falls back to appending a thought

## Limitations

- Utterance length is capped at 10,000 characters per impose request
- Style instruction text is limited to 5,000 characters per category
- Writing sample text is limited to 10,000 characters; maximum 5 samples per category
- Draft generation depends on Gemini 2.5 Flash availability — if the LLM call fails, the event is still recorded but no draft is produced
- No collaborative editing — each buffer belongs to a single authenticated user
- No export formats beyond markdown
- Three writing categories only: threads, linkedin, general

---

_Part of [IntexuraOS](../overview.md) — Think freely, write later._

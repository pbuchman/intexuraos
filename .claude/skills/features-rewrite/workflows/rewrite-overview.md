# Workflow: Rewrite Overview

Convergence loop for rewriting `docs/overview.md` — the functional overview of the entire platform.

Unlike single-service rewrites, this workflow uses ALL 24 features.md files as input. The overview must cohere across every service, sorted by impact on the system.

## Phase 1: Gather Inputs

### 1.1 Read All Features

Read every `docs/services/*/features.md` file. For each, extract:

- Title and subtitle (line 1 and 3)
- The Problem section (first paragraph only)
- Key Benefits section (full)
- Limitations section (full)

Concatenate into `{{ALL_FEATURES}}` with service name headers.

### 1.2 Read Current Overview

Read `docs/overview.md` → `{{CURRENT_OVERVIEW}}`

### 1.3 Extract Platform Vision

Search `memory/feature-review-log.md` for a section titled `### Platform Overview` or `### overview`. If none exists, use AskUserQuestion:

> "No platform-level vision found. Please describe: What is IntexuraOS's core story? What should the overview emphasize? How should services be ordered (by user impact, by workflow order, by capability type)?"

This becomes `{{PLATFORM_VISION}}`.

### 1.4 Initialize Round Counter

Set `{{ROUND}}` = 1, `{{FEEDBACK}}` = "This is the first draft. No prior feedback."

---

## Phase 2: Draft

### 2.1 Prepare Writer Prompt

The overview writer has a different brief than single-service writers:

```
You are rewriting docs/overview.md for IntexuraOS — a platform with 24 services.

PLATFORM VISION:
{{PLATFORM_VISION}}

ALL SERVICE FEATURES (extracted from each features.md):
{{ALL_FEATURES}}

CURRENT OVERVIEW:
{{CURRENT_OVERVIEW}}

ROUND: {{ROUND}}
FEEDBACK: {{FEEDBACK}}

RULES:
- This is a FUNCTIONAL overview — what the platform does for users, not how it's built
- Sort services by impact on the user's experience, not by technical category
- Each service gets 2-3 sentences maximum — the features.md is the deep dive
- No version numbers, no Pub/Sub topics, no Firestore collections, no env vars
- No mermaid diagrams — prose and tables only
- Link to each service's features.md for details
- NYT voice: declarative, specific, no marketing fluff
- Structure: Vision → What You Can Do (services by impact) → How It Works (high-level flow) → Getting Started → Limitations
- The overview must make sense to someone who has never seen the platform
- Every claim must be traceable to a specific service's features.md

Return ONLY the markdown content for overview.md.
```

### 2.2 Spawn Writer Agent

```
Task tool:
  subagent_type: general-purpose
  model: opus
  name: "overview-writer"
  prompt: <substituted writer prompt>
```

### 2.3 Write Draft

Write the writer's output to `docs/overview.md`.

### 2.4 User Checkpoint

> **Round {{ROUND}} overview draft written to `docs/overview.md`.**
>
> Options:
>
> 1. "Proceed to critics" — send to 6 critics for evaluation
> 2. "Redirect" — provide feedback to incorporate before critics see it

---

## Phase 3: Critic Evaluation

### 3.1 Adapted Critic Context

All 6 critics receive the same roles as single-service reviews, but with adapted context:

- **PA (Opus)**: Receives `{{ALL_FEATURES}}` as fact source (replaces technical.md). Checks that every claim in the overview is traceable to a specific service's features.md. Checks for cross-service consistency — if overview says "24 services" but only 20 are mentioned, that's an error.
- **External Developer (Sonnet)**: Evaluates whether someone new to IntexuraOS understands the platform from the overview alone.
- **Product Strategist (Sonnet)**: Evaluates whether the platform story is compelling and differentiated as a whole.
- **End User (Sonnet)**: Checks for jargon and technical terms that leaked from features.md into the overview.
- **First-Time Builder (Sonnet)**: Evaluates whether the overview inspires someone to explore individual services.
- **Competitor Analyst (Sonnet)**: Evaluates the platform's competitive positioning as a unified product, not individual services.

### 3.2 Spawn 6 Critics

Same parallel spawn pattern as `rewrite-single.md` Phase 3.2, but:

- PA prompt includes `{{ALL_FEATURES}}` instead of `{{TECHNICAL_MD}}`
- All critic prompts include `{{PLATFORM_VISION}}` instead of per-service vision
- Draft is the full overview.md

### 3.3 Print Convergence Table

Same format as `rewrite-single.md` Phase 3.3.

---

## Phase 4: Convergence Decision

Same decision matrix as `rewrite-single.md` Phase 4. Same 3-round maximum.

---

## Phase 5: Targeted Edit Pass

Same as `rewrite-single.md` Phase 5, but edits apply to `docs/overview.md`.

---

## Phase 6: Present Final

### 6.1 Display Final Output

Show the user:

1. The final overview.md content
2. The most recent convergence table
3. Services mentioned vs total services (completeness check)

### 6.2 User Approval

> **Final overview draft ready.**
>
> Options:
>
> 1. "Accept" — overview.md is done
> 2. "Additional direction" — provide feedback for another pass

### 6.3 Log to Rewrite History

Append an entry to `docs/features-rewrite-history.md` under a new heading:

```
## {{DATE}} — Overview Rewrite

| PA | Dev | Strat | EU | Build | Comp | Avg | SHIP | Outcome |
```

Include the trigger (which service rewrite caused this, or manual invocation).

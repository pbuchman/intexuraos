# Document Service

Generate professional documentation for a service, then update project-level docs.

**Usage:**

```
/document-service <service-name>
/document-service                   # Lists available services
```

---

## Overview

This skill produces two documentation files per service:

| File           | Purpose                                     | Audience              |
| -------------- | ------------------------------------------- | --------------------- |
| `features.md`  | Value propositions, capabilities, use cases | Users, marketing      |
| `technical.md` | Architecture, APIs, patterns, gotchas       | Developers, AI agents |

After service documentation, project-level docs are updated with an integrated narrative.

---

## Output Structure

```
docs/
├── services/
│   ├── <service-name>/
│   │   ├── features.md      # Marketing-ready
│   │   └── technical.md     # Developer-ready
│   └── .../
├── overview.md              # Project narrative (auto-updated)
└── documentation-runs.md    # Run history log
```

---

## Phase 1: Service Analysis

### Step 1.1: Explore Service Structure

Launch Explore agent to analyze the service:

```
Analyze the structure of apps/<service-name>/. Find:

1. **Routes** — All endpoints (public and internal)
   - HTTP method, path, purpose
   - Request/response schemas

2. **Domain Models** — Core entities and their relationships
   - Status enums and their meanings
   - Key fields and validation rules

3. **Use Cases** — Business operations
   - What each use case does
   - Input/output types
   - Dependencies

4. **External Integrations** — What external services it calls
   - APIs consumed
   - Pub/Sub topics published/subscribed

5. **Configuration** — Required environment variables
   - What each var controls
   - Terraform references

Search in: apps/<service-name>/src/
```

### Step 1.2: Check Existing Documentation

```bash
# Check for existing docs
ls -la docs/services/<service-name>/ 2>/dev/null || echo "No existing docs"

# Check for service-level context
cat apps/<service-name>/README.md 2>/dev/null || echo "No README"
```

---

## Phase 2: Interview (5-10 Questions)

**MANDATORY:** Ask the user these questions to capture insights code can't provide.

Present questions one at a time. Wait for answer before next question.

### Question Set

1. **Why does this service exist?**

   > "What problem does <service-name> solve? What was the pain point before it existed?"

2. **Who is this for?**

   > "Describe the target user. What's their context when they use this?"

3. **What's the killer feature?**

   > "If you had to highlight ONE capability, what would it be?"

4. **Real-world use case?**

   > "Give me a concrete example: 'User does X, service does Y, user gets Z.'"

5. **What makes it different?**

   > "How does this approach differ from alternatives? Why this design?"

6. **Known limitations?**

   > "What can't it do? What's on the roadmap?"

7. **Gotchas?**
   > "What do developers need to know that isn't obvious from the code?"

### Capture Format

Store answers in working memory for document generation:

```
Service: <service-name>
Date: YYYY-MM-DD

Q1 (Why): [answer]
Q2 (Who): [answer]
Q3 (Killer): [answer]
Q4 (Use case): [answer]
Q5 (Different): [answer]
Q6 (Limitations): [answer]
Q7 (Gotchas): [answer]
```

---

## Phase 3: Generate features.md

Write to `docs/services/<service-name>/features.md`:

```markdown
# <Service Display Name>

<One-sentence value proposition — what problem it solves>

## The Problem

<2-3 sentences describing the pain point this service addresses>

## How It Helps

### <Capability 1 — action-oriented title>

<What it does + why it matters>

**Example:** <Real-world scenario showing value>

### <Capability 2>

...

### <Capability 3>

...

## Use Case

<Concrete walkthrough: User does X → Service does Y → User gets Z>

## Key Benefits

- <Benefit 1 — outcome-focused>
- <Benefit 2>
- <Benefit 3>

## Limitations

<Honest about what it doesn't do — builds trust>

---

_Part of [IntexuraOS](../overview.md) — <tagline>_
```

### Writing Guidelines

- **Lead with value**, not features
- **Use active voice**: "Sends notifications" not "Notifications are sent"
- **Be specific**: "Responds in <2 seconds" not "Fast response times"
- **Real examples**: Concrete scenarios, not abstract descriptions
- **No jargon**: Write for intelligent non-technical readers

---

## Phase 4: Generate technical.md

Write to `docs/services/<service-name>/technical.md`:

```markdown
# <Service Name> — Technical Reference

## Overview

<2-3 sentences: what it does, where it runs, key dependencies>

## Architecture
```

<ASCII diagram of key components>
```

## API Endpoints

### Public Endpoints

| Method | Path        | Purpose         |
| ------ | ----------- | --------------- |
| GET    | `/resource` | List resources  |
| POST   | `/resource` | Create resource |

### Internal Endpoints

| Method | Path                 | Purpose            | Caller        |
| ------ | -------------------- | ------------------ | ------------- |
| POST   | `/internal/resource` | Internal operation | other-service |

## Domain Model

### <Entity Name>

| Field    | Type     | Description       |
| -------- | -------- | ----------------- |
| `id`     | `string` | Unique identifier |
| `status` | `Status` | Current state     |

**Status Values:**

| Status      | Meaning                |
| ----------- | ---------------------- |
| `pending`   | Awaiting processing    |
| `completed` | Successfully processed |

## Pub/Sub

### Published Events

| Topic        | Event Type   | Payload           | Trigger        |
| ------------ | ------------ | ----------------- | -------------- |
| `TOPIC_NAME` | `event.type` | `{ field: type }` | When X happens |

### Subscribed Events

| Topic        | Handler                    | Action |
| ------------ | -------------------------- | ------ |
| `TOPIC_NAME` | `/internal/pubsub/handler` | Does X |

## Dependencies

### External Services

| Service      | Purpose       | Failure Mode    |
| ------------ | ------------- | --------------- |
| WhatsApp API | Send messages | Queue for retry |

### Internal Services

| Service      | Endpoint             | Purpose       |
| ------------ | -------------------- | ------------- |
| user-service | `/internal/user/...` | Get user data |

## Configuration

| Variable       | Purpose     | Required |
| -------------- | ----------- | -------- |
| `INTEXURAOS_X` | Description | Yes      |

## Gotchas

- <Non-obvious behavior 1>
- <Non-obvious behavior 2>

## File Structure

```
apps/<service-name>/src/
├── domain/
│   ├── models/
│   └── usecases/
├── infra/
├── routes/
└── services.ts
```

````

---

## Phase 5: Update Project Overview

Update `docs/overview.md` with integrated narrative:

```markdown
# IntexuraOS

<One paragraph: what is it, who is it for, what problem does it solve>

## How It Works

### <Problem Category 1>

<Narrative explaining how services work together to solve this>

**Services involved:** <service-a>, <service-b>

### <Problem Category 2>

...

## Services

| Service | Purpose | Docs |
|---------|---------|------|
| <service-name> | <one-line purpose> | [Features](services/<service>/features.md) · [Technical](services/<service>/technical.md) |

## Getting Started

<Brief onboarding path>

## Architecture

<High-level diagram or description>
````

**Note:** Update the narrative section if the new service adds capabilities. Maintain the problem-focused structure.

---

## Phase 6: Log the Run

Append to `docs/documentation-runs.md`:

```markdown
## YYYY-MM-DD — <service-name>

**Action:** [Created | Updated]
**Files:**

- `docs/services/<service-name>/features.md`
- `docs/services/<service-name>/technical.md`
- `docs/overview.md` (updated)

**Insights Captured:**

- Why: <summary>
- Killer feature: <summary>
- Limitations: <summary>

**Changes from previous:**

- <What changed, if update>

---
```

---

## Idempotency Rules

Running this skill multiple times should:

1. **Preserve structure** — Same headings, same format
2. **Update content** — Reflect current code state
3. **Retain insights** — Don't lose user-provided context (re-ask if missing)
4. **Track changes** — Log what changed in documentation-runs.md

### Before Overwriting

If docs exist, compare:

```bash
git diff docs/services/<service-name>/
```

Ask user: "Existing docs found. Update with new analysis, or start fresh?"

---

## Verification

After generating:

1. **Review features.md** — Read aloud. Does it sound like marketing copy?
2. **Review technical.md** — Can a new developer understand the service?
3. **Check overview.md** — Does the narrative include the new service?
4. **Verify log** — Is the run recorded in documentation-runs.md?

---

## Quick Start Checklist

- [ ] Service analyzed (routes, models, use cases)
- [ ] Interview completed (7 questions answered)
- [ ] features.md generated
- [ ] technical.md generated
- [ ] overview.md updated
- [ ] Run logged in documentation-runs.md
- [ ] User reviewed output

---

## Example Interview Flow

```
Claude: Let's document whatsapp-service.

Q1: Why does this service exist?
User: "Before this, we had no way to interact with the system on mobile.
       WhatsApp is always open, so it's the natural interface."

Q2: Who is this for?
User: "Busy professionals who want to capture thoughts without opening an app."

Q3: What's the killer feature?
User: "Voice notes → automatic transcription → actionable todos."

Q4: Real-world use case?
User: "I'm driving, think of something, send a voice note. When I get home,
       it's already a todo with context."

Q5: What makes it different?
User: "No separate app to install. Uses what you already have open."

Q6: Known limitations?
User: "Only works with WhatsApp. No SMS, no Telegram yet."

Q7: Gotchas?
User: "Rate limits from Meta. Can't send more than X messages per minute."

Claude: Got it. Generating documentation...
```

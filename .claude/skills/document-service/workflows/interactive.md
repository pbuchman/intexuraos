# Interactive Workflow

Run when `/document-service <service-name>` is invoked.

## Purpose

Document a single service with user input for questions that cannot be reliably inferred from code.

## Phases

1. Service Analysis
2. Interview (3 open questions + wizard inference)
3. Generate Documentation (5 files)
4. Update Website Content
5. Log the Run

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
ls -la docs/services/<service-name>/ 2>/dev/null || echo "No existing docs"
cat apps/<service-name>/README.md 2>/dev/null || echo "No README"
```

### Step 1.3: Check Previous Runs

```bash
grep -A 10 "## .* — <service-name>" docs/documentation-runs.md 2>/dev/null || echo "No previous runs"
```

### Step 1.4: Documentation Coverage Validation

Calculate coverage using formula in [coverage-calculation.md](../reference/coverage-calculation.md).

---

## Phase 2: Interview

**STRICT RULES:**

- **MAX 3 open questions** per service run
- **ALL other insights**: Infer from code analysis OR ask via wizard (multiple choice)
- **NEVER guess**: If inference confidence < 100%, ask wizard question

### Question Matrix

| #   | Question                         | Type     | Inference Source                                   |
| --- | -------------------------------- | -------- | -------------------------------------------------- |
| 1   | **Why does this service exist?** | **OPEN** | Ask user (not inferable)                           |
| 2   | **Primary user type?**           | Wizard   | Route analysis (internal-only → Internal Services) |
| 3   | **Interaction style?**           | Wizard   | Routes, Pub/Sub subscriptions, scheduled jobs      |
| 4   | **Data processing mode?**        | Wizard   | HTTP methods, domain use cases                     |
| 5   | **What's the killer feature?**   | **OPEN** | Ask user (value judgment)                          |
| 6   | **State management?**            | Wizard   | Firestore collections, external deps               |
| 7   | **Known limitations?**           | Wizard   | Rate limits, quotas, validation rules              |
| 8   | **Planned future developments?** | **OPEN** | Ask user (not inferable)                           |

### Open Questions (Ask User)

#### Q1: Why does this service exist?

> "What problem does `<service-name>` solve? What was the pain point before it existed?"

**Capture:** User's exact words for features.md "The Problem" section

#### Q5: What's the killer feature?

> "If you had to highlight ONE capability, what would it be?"

**Capture:** User's exact words for features.md lead capability

#### Q8: What are the planned future developments?

> "What's planned for future development? Any upcoming features, refactors, or changes?"

**Capture:** User's exact words for technical-debt.md "Future Plans" section

### Wizard Questions

See [inference-rules.md](../reference/inference-rules.md) for when to infer vs ask.

---

## Phase 3: Generate Documentation

Generate 4 files using templates:

1. [features-template.md](../templates/features-template.md)
2. [technical-template.md](../templates/technical-template.md)
3. [tutorial-template.md](../templates/tutorial-template.md)
4. [technical-debt-template.md](../templates/technical-debt-template.md)

**Note:** `agent.md` is only generated in autonomous mode.

### Quality Assurance Loop

Before writing files to disk:

1. **Review features.md**: Is passive voice used? Rewrite to active.
2. **Review technical.md**: Can a new developer understand the service?
3. **Review tutorial.md**: Are all code examples runnable?
4. **Review technical-debt.md**: Are items actionable?

---

## Phase 4: Update Website Content

Incrementally update:

1. `docs/services/index.md` — Add to catalog
2. `docs/site-marketing.md` — Add capabilities, use cases
3. `docs/site-developer.md` — Add APIs, events, data models
4. `docs/site-index.json` — Add service metadata
5. `docs/overview.md` — Update narrative if needed

---

## Phase 5: Log the Run

Append to `docs/documentation-runs.md`:

```markdown
## YYYY-MM-DD — <service-name>

**Action:** [Created | Updated]
**Files:**

- `docs/services/<service-name>/features.md`
- `docs/services/<service-name>/technical.md`
- `docs/services/<service-name>/tutorial.md`
- `docs/services/<service-name>/technical-debt.md`
- ... (website files updated)

**Insights Captured:**

- Why: <summary>
- Killer feature: <summary>
- Future plans: <summary>
- Limitations: <summary>

**Documentation Coverage:** <percentage>%

---
```

---

## Idempotency

When updating existing docs:

1. **Preserve user insights** from previous runs (re-ask if missing)
2. **Archive resolved debt** — Move fixed items to "Resolved Issues"
3. **Track changes** — Log what changed in documentation-runs.md

### Before Overwriting

If docs exist, ask user:

> "Existing docs found. Update with new analysis, or start fresh?"

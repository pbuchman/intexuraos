# Autonomous Workflow

Run when Task tool is invoked with `subagent_type: service-scribe`.

## Purpose

Generate comprehensive documentation for one or more services without human intervention, inferring all insights from code analysis and git history.

## Key Difference from Interactive Mode

| Aspect      | Interactive | Autonomous                       |
| ----------- | ----------- | -------------------------------- |
| Q1 (Why)    | Asks user   | Infers from git history + README |
| Q5 (Killer) | Asks user   | Infers from code complexity      |
| Q8 (Future) | Asks user   | Infers from TODOs + debt docs    |
| Output      | 4 files     | 5 files (includes agent.md)      |

## Phases

1. Service Discovery (batch mode only)
2. Service Analysis & Git Context
3. Inference Engine
4. Documentation Generation
5. Quality Assurance Loop
6. Website Content Updates
7. Log the Run

---

## Phase 1: Service Discovery (Batch Mode)

When documenting multiple services:

1. List all services in `apps/` (excluding `web`)
2. Check documentation status for each
3. Prioritize:
   - First: Services with no documentation
   - Second: Stale documentation
   - Third: Minor refresh needed

---

## Phase 2: Service Analysis & Git Context

### Git History (Smart Context)

```bash
git log -n 15 --pretty=format:"%h - %s (%cr)" apps/<service-name>/
```

Extract:

- **Hotspots:** Which files changed most often?
- **Focus:** Are recent commits `fix:` (stability), `feat:` (growth), or `refactor:` (debt)?
- **Features:** "Added X capabilities" from commit messages

### Code Analysis

Analyze `apps/<service-name>/src/`:

1. **Routes**: All endpoints (public + internal)
2. **Domain Models**: Entities, status enums, validation rules
3. **Use Cases**: Business operations, input/output types
4. **Infrastructure**: Firestore collections, Pub/Sub, external APIs
5. **Configuration**: Environment variables, Terraform refs
6. **Documentation Coverage**: JSDoc, @summary, @description

---

## Phase 3: Inference Engine

**CRITICAL:** Infer ALL answers that interactive mode would ask the user.

### Inference Rules

| Question                | Inference Sources                                                       |
| ----------------------- | ----------------------------------------------------------------------- |
| **Q1: Why exists?**     | Git first commit, README.md, existing features.md "The Problem" section |
| **Q5: Killer feature?** | Most complex endpoint, most use cases, primary integration point        |
| **Q8: Future plans?**   | TODO/FIXME comments, technical-debt.md "Future Plans", GitHub issues    |

See [inference-rules.md](../reference/inference-rules.md) for detailed rules.

### Q1 - Service Purpose (Why it exists)

1. Search `apps/<service-name>/README.md` for problem statement
2. Check initial Git commits for the service
3. Read existing `docs/services/<service>/features.md` if present
4. Analyze the main use case — what problem does it solve?
5. **Format:** 2-3 sentences describing the pain point addressed

### Q5 - Killer Feature

1. Identify the most complex route (most lines, most logic)
2. Check which endpoints have the most detailed implementation
3. Look for unique capabilities not found in other services
4. **Format:** One specific capability with clear value

### Q8 - Future Plans

1. Grep for `TODO:`, `FIXME:`, `HACK:` comments
2. Read existing `technical-debt.md` "Future Plans" section
3. Check for incomplete implementations (stubs, placeholder logic)
4. **Format:** List of planned work items

### Wizard Questions - Pure Code Analysis

- Q2 (User Type): Count `/internal/*` vs public routes
- Q3 (Interaction): Detect Pub/Sub, webhooks, scheduled jobs
- Q4 (Data Mode): Analyze HTTP methods (GET vs POST/PUT/DELETE)
- Q6 (State): Check Firestore collections, external state
- Q7 (Limitations): Find rate limits, quotas, validation rules

---

## Phase 4: Documentation Generation

Generate **five** output files per service:

1. [features-template.md](../templates/features-template.md) — Marketing-ready
2. [technical-template.md](../templates/technical-template.md) — Developer reference
3. [tutorial-template.md](../templates/tutorial-template.md) — Getting-started guide
4. [technical-debt-template.md](../templates/technical-debt-template.md) — Debt tracking
5. [agent-template.md](../templates/agent-template.md) — Machine-readable interface

---

## Phase 4.5: Quality Assurance Loop

**Before writing files to disk:**

1. **Review features.md:**
   - Check: Is passive voice used? → Rewrite to active
   - Check: Is there jargon? → Rewrite to focus on user benefit

2. **Review technical.md:**
   - Check: Does "Recent Changes" reflect actual git history?

3. **Review agent.md:**
   - Check: Is it concise? Remove all fluff
   - Check: Are schemas valid TypeScript interfaces?

4. **Review technical-debt.md:**
   - Check: Are "Future Plans" specific? Replace vague items with specific TODOs found in code

---

## Phase 5: Website Content Updates

After documenting each service, incrementally update:

1. `docs/services/index.md` — Add to Documented, remove from Pending
2. `docs/site-marketing.md` — Add capabilities, use cases, roadmap items
3. `docs/site-developer.md` — Add APIs, events, data models
4. `docs/site-index.json` — Update services array and stats
5. `docs/overview.md` — Update narrative if service adds new capability category

---

## Phase 6: Log the Run

Append to `docs/documentation-runs.md`:

```markdown
## YYYY-MM-DD — <service-name>

**Action:** [Created | Updated]
**Agent:** service-scribe (autonomous)

**Files:**

- `docs/services/<service-name>/features.md`
- `docs/services/<service-name>/technical.md`
- `docs/services/<service-name>/tutorial.md`
- `docs/services/<service-name>/technical-debt.md`
- `docs/services/<service-name>/agent.md`
- ... (website files updated)

**Inferred Insights:**

- Why: <summary from code analysis>
- Killer feature: <summary from code analysis>
- Future plans: <summary from TODO/README/debt docs>
- Limitations: <summary from code analysis>

**Documentation Coverage:** <percentage>%

**Technical Debt Found:**

- Code smells: N
- Test gaps: N
- Type issues: N
- TODOs: N

---
```

---

## Execution Workflows

### Batch Mode (All Services)

1. Run Phase 1: Discovery — list all, prioritize order
2. For each service in priority order:
   - Phases 2-4.5: Analysis → Inference → Generation → QA
   - Phase 5: Website updates
   - Phase 6: Log run
3. After all services: Final overview.md update
4. Provide summary

### Targeted Mode (Specific Services)

1. Receive list of services to document
2. For each service: Phases 2-6
3. Update overview.md
4. Provide summary per service

---

## Idempotency Rules

1. **Preserve user-provided insights** from previous runs
2. **Archive resolved debt**: Move fixed items to "Resolved Issues"
3. **Incremental website updates**: Append new services, don't regenerate

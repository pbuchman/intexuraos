# Autonomous Workflow

Run when Task tool is invoked with `subagent_type: service-scribe`.

For **parallel multi-agent** documentation of the full monorepo, see [team.md](team.md) instead.

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

### Release Context (Optional)

If the Task prompt includes a `## Release Context` section, this service
is being documented as part of a release. Use the provided context to
enhance documentation quality:

1. **Recent Changes (technical.md)**: Use the triage descriptions as the
   primary source for the "Recent Changes" section. These are
   human-reviewed, netted summaries — more accurate than raw git log
   parsing. Still run `git log` to catch fixes not covered by the
   change groups.

2. **Feature emphasis (features.md)**: Items marked `[Highlighted]` are
   the release's headline features. Give them prominent placement —
   they should appear early with strong benefit-oriented language.
   Use user comments (when present) to calibrate description tone.

3. **Version tag scope**: Use `Last tag` from the release context to
   scope `git log` to only changes since that tag, rather than the
   default `git log -n 15`.

4. **Inference hints (Phase 3)**: Release context provides strong
   signals for Q1 (recent value added) and Q5 (highlighted items are
   killer feature candidates). Use as hints but still validate
   against code.

5. **Skip-priority items**: Features omitted from the context were
   deliberately deprioritized. Do not highlight them. They may appear
   in git history — document normally without special prominence.

**When release context is NOT present:** Proceed with standard git log
analysis as defined below. This subsection is a no-op.

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

## Phase 3.5: Factual Grounding (Anti-Hallucination)

**MANDATORY — run before generating ANY documentation content.**

Before writing documentation, collect ground-truth facts that constrain all generated text:

### Version Grounding

```bash
git tag -l "v*" --sort=-v:refname | head -20
```

Store the list of valid version tags. **HARD RULE:** Only these version numbers may appear in generated docs. Never invent version numbers (e.g., v4.0.0, v4.1.0, v5.0.0) that don't exist in the tag list. If describing when a feature was introduced and you can't determine the exact version from git history, omit the version reference entirely rather than guessing.

### Endpoint Grounding

```bash
# Collect all registered routes from the service
grep -rn "fastify\.\(get\|post\|put\|delete\|patch\)" apps/<service-name>/src/routes/
```

Store the list of actual endpoints. **HARD RULE:** Only these endpoints may be documented. Never fabricate endpoints, URL patterns, or HTTP methods that don't exist in route files.

### Environment Variable Grounding

```bash
# Collect declared env vars
grep -n "REQUIRED_ENV\|process\.env\." apps/<service-name>/src/index.ts
```

Store the list of actual env vars. **HARD RULE:** Only these env vars may appear in docs. Never invent env var names.

### No-Fabrication Rules

| Category                  | Rule                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Version numbers**       | Only versions from `git tag -l "v*"` — never invent                                                    |
| **Endpoints**             | Only routes from actual route files — never fabricate                                                  |
| **Env vars**              | Only vars from `REQUIRED_ENV` or `process.env` usage — never invent                                    |
| **Resource limits**       | Only limits explicitly coded (rate limits, quotas) — never fabricate "typical" or "recommended" values |
| **Line counts**           | Never cite specific line counts ("~500 lines") — code changes constantly                               |
| **Method/class names**    | Only names that exist in the source — verify before citing                                             |
| **External service URLs** | Only URLs found in code or config — never guess                                                        |
| **Domain model fields**   | Only fields from actual TypeScript interfaces — verify before listing                                  |

### Typographic Style

- Use em-dashes (`—`) for parenthetical statements, NOT ASCII double-dashes (`--`)
- Use en-dashes (`–`) for ranges (e.g., "v3.1.0–v3.2.0"), NOT hyphens
- Consistent markdown formatting throughout all generated files

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

### Style Checks

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

### Factual Validation (MANDATORY)

**Every claim in every generated file MUST be validated against the grounding data from Phase 3.5.**

Run these checks on all generated content before writing to disk:

1. **Version check:** Scan all generated files for version patterns (`v\d+\.\d+\.\d+`). Every match MUST exist in the grounded version tag list. If any version is not in the list, **remove it** — do not guess a replacement.

2. **Endpoint check:** Every endpoint mentioned in `technical.md` and `agent.md` MUST exist in the grounded endpoint list from Phase 3.5. If an endpoint is documented but not in the list, **remove it**.

3. **Env var check:** Every environment variable mentioned in `technical.md` and `agent.md` MUST exist in the grounded env var list. If an env var is documented but not in the list, **remove it**.

4. **Domain model check:** Every TypeScript interface field, enum value, or type mentioned in docs MUST match the actual source. Spot-check by reading the relevant source file — don't rely on inference.

5. **Typographic check:** Scan all generated files for ASCII double-dashes surrounded by spaces (`--`). Replace every instance with em-dash (`—`). Also check for `--` in section headings and descriptive text (code blocks and CLI flags are exempt).

6. **No-fabrication check:** Scan for:
   - Specific line counts (e.g., "~500 lines") → **remove**
   - Resource limits not found in code (e.g., "handles up to 10,000 requests") → **remove**
   - Latency claims not measured (e.g., "responds in <50ms") → **remove**
   - Architecture descriptions that don't match actual file structure → **rewrite**

**If ANY check fails:** Fix the content and re-run the failing check. Do NOT proceed to writing files until all checks pass.

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

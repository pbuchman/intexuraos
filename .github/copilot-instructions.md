# PraxOS — Global Copilot Instructions

These rules apply to **all code changes** in this repository.
Path-specific rules are in `.github/instructions/*.instructions.md`.

---

## Repository Structure

```
praxos/
├── apps/                    # Deployable services (Fastify)
│   ├── auth-service/        # Example: authentication service
│   ├── notion-gpt-service/  # Example: Notion integration service
│   └── api-docs-hub/        # Example: API documentation hub
├── packages/
│   ├── common/              # Shared utilities (Result types, etc.)
│   ├── domain/              # Business logic, no external dependencies
│   │   ├── identity/
│   │   ├── promptvault/
│   │   └── actions/
│   └── infra/               # External service adapters
│       ├── auth0/
│       ├── notion/
│       └── firestore/
├── docs/                    # All documentation lives here
├── scripts/                 # Build/deploy scripts
└── docker/                  # Docker configurations
```

---

## Non-Negotiable Global Rules

### 1. TypeScript Correctness

- Zero `tsc` errors across all packages and apps.
- Forbidden: `@ts-ignore`, `@ts-expect-error`, unsafe casts.
- `any` allowed only with inline justification.
- Explicit return types on all exported functions.

**Enforcement:** `npm run typecheck` (part of CI)

### 2. Zero Warnings

- No TypeScript warnings.
- No ESLint warnings.
- No test runner warnings.
- No unused imports, variables, deprecated APIs.
- Always remove unused imports/exports as part of each change before considering a task complete.

**If tooling reports it, you fix it.**

**Enforcement:** `npm run lint` (part of CI)

### 3. ESM Only

- Use `import` / `export`.
- No `require()`, no `module.exports`.

**Enforcement:** TypeScript configuration, ESLint rules

### 4. No Dead Code

- Remove unused code immediately.
- No TODO without issue reference or clear justification.

**Enforcement:** Manual review, ESLint unused variable detection

### 5. No Magic Strings

- Extract constants or use configuration.
- No copy-pasted logic — create shared utilities.

**Enforcement:** Code review

### 6. No Obvious Comments

- Do not add comments that restate what code does.
- Comments explain **why**, not **what**.
- Delete worthless comments: `// increment counter`, `// return the value`.

**Enforcement:** Code review

### 7. External Contracts

Do not change casually:

- HTTP response shapes
- Message formats
- Database schemas

If unavoidable: explicit, minimal, documented.

**Enforcement:** Manual review, testing

---

## No Trash Policy

- No dead code. Remove unused imports, functions, variables.
- No TODOs without tracking. Every TODO must reference an issue or be removed.
- No warnings. ESLint must pass with zero warnings. All rules are errors.
- No commented-out code blocks.
- No `any` types. Use proper typing or `unknown` with type guards.

**Enforcement:** Covered by global rules above

---

## Boundary Rules

Import hierarchy (strict, enforced by ESLint):

1. **common** - can only import from `common`
2. **domain** - can import from `common` and other `domain` packages
3. **infra** - can import from `common`, `domain`, and other `infra` packages
4. **apps** - can import from anything

Violations:

- ❌ domain importing from infra
- ❌ domain importing from apps
- ❌ infra importing from apps

**Enforcement:** ESLint boundaries plugin + `npm run verify:boundaries` (part of CI)

---

## Documentation Policy

- All documentation lives in `docs/`
- READMEs outside `docs/` must only contain:
  - Brief purpose statement
  - Links to relevant docs

**Enforcement:** Manual review (planned: automated verification)

---

## Testing Requirements

- All code must have tests
- Coverage thresholds: 90% lines, 85% branches, 90% functions, 90% statements
- Use Vitest
- Test files: `*.test.ts` or `*.spec.ts`

**Enforcement:** vitest.config.ts thresholds + `npm run test:coverage` (part of CI)

### Forbidden Tests

- "renders without crashing" tests
- Snapshot-only tests
- Tests asserting only mock calls
- Tests that pass after breaking real logic

### Required Properties

- Assert **observable behavior**.
- Fail on **realistic regressions**.
- Mock external systems (Auth0, Firestore, Notion, Chrome APIs), not the system under test.

---

## Code Style

- TypeScript ESM (NodeNext)
- Strict mode enabled
- Explicit return types on all functions
- No implicit any
- Use Result types for operations that can fail

**Enforcement:** TypeScript configuration (tsconfig.base.json), ESLint rules

---

## Verification Commands

Run from repo root:

| Check              | Command                           | Notes                                           |
| ------------------ | --------------------------------- | ----------------------------------------------- |
| Typecheck          | `npm run typecheck`               | Must run before lint when packages change       |
| Lint all           | `npm run lint`                    | Requires built .d.ts files for workspace pkgs   |
| Format check       | `npm run format:check`            | Run `npm run format` to auto-fix                |
| Test all           | `npm run test`                    |                                                 |
| Coverage           | `npm run test:coverage`           |                                                 |
| Build all          | `npm run build`                   | Alias for typecheck (both run tsc -b)           |
| Terraform format   | `terraform fmt -check -recursive` | Run from `/terraform`, use `-recursive` to fix  |
| Terraform validate | `terraform validate`              | Run from `/terraform` or specific environment   |
| Full CI            | `npm run ci`                      | **MANDATORY** - runs all checks in proper order |

**CI Script Order (CRITICAL):**

```bash
typecheck → lint → verify:* → format:check → test:coverage → build
```

Why this order matters:

1. `typecheck` runs first to build `.d.ts` files for all workspace packages
2. `lint` runs second because ESLint's type-aware rules need those `.d.ts` files
3. Without step 1, ESLint fails with "unsafe assignment of error typed value"

**Never change CI script order without understanding this dependency.**

Always finish a task by running `npm run ci` and ensuring it passes. If terraform files changed, also run terraform checks.

---

## Task Completion Checklist

**When you finish ANY task, you MUST follow this quality loop:**

### Quality Loop (MANDATORY)

1. **Run all quality checks:**
   - [ ] `npm run typecheck` passes
   - [ ] `npm run lint` passes
   - [ ] `npm run format:check` passes (run `npm run format` to fix)
   - [ ] `npm run test` passes
   - [ ] **`npm run test:coverage` passes with ≥90% coverage** ← **MANDATORY**
   - [ ] If terraform files changed: `terraform fmt -check -recursive` passes (run `terraform fmt -recursive` to fix)
   - [ ] **`npm run ci` passes** ← **MANDATORY**

2. **If ANY check fails:**
   - Fix the issues
   - Go back to step 1 (repeat until all pass)

3. **Only when ALL checks pass:**
   - Task is complete
   - Path-specific checklist completed (see `.github/instructions/*.instructions.md`)

### Additional Requirements

- **Coverage thresholds (non-negotiable):**
  - Lines: ≥90%
  - Branches: ≥85%
  - Functions: ≥90%
  - Statements: ≥90%
- No new warnings introduced
- Changes to logic have corresponding tests
- Terraform changes validated (if applicable)

**CRITICAL: Coverage is a quality gate**

- Coverage below 90% is a **blocking failure**
- Add tests until coverage meets thresholds
- Do NOT claim task complete until coverage passes
- Coverage check is part of `npm run ci` - it will fail if below threshold

**CRITICAL: When adding or modifying workspace packages (@praxos/\*)**

Before running `npm run lint`, you MUST:

- Run `npm run build` or `npm run typecheck` first
- This ensures `.d.ts` files exist for ESLint's type-aware rules
- Without built declarations, ESLint will fail with "error typed value" errors
- The `npm run ci` script handles this automatically by running `typecheck` before `lint`

**CRITICAL: When modifying Terraform files**

Before claiming task complete, you MUST:

- Run `terraform fmt -recursive` to format
- Run `terraform fmt -check -recursive` to verify
- Run `terraform validate` in affected environments
- See `.github/instructions/terraform.instructions.md` for full checklist

**Do not claim "done" until the quality loop completes successfully. Running `npm run ci` with passing coverage and terraform checks (if applicable) is non-negotiable.**

---

## Honesty Rules

- Do not claim work is complete unless it actually is.
- Do not bluff about coverage or correctness.
- If ambiguous: make a reasonable decision and document it.

---

## Output Preferences

**When presenting information or summaries:**

- **Prefer `show_content` tool** if available (displays in dedicated window)
- Use structured output (markdown, tables) for clarity
- Keep inline responses concise when tool is preferred

---

## Instruction Maintenance

**REQUIRED: Keep these instruction files up to date.**

When a new rule, pattern, or approach is established during development:

1. **Immediately update** the appropriate instruction file:
   - Global rules → `.github/copilot-instructions.md`
   - Apps-specific → `.github/instructions/apps.instructions.md`
   - Packages-specific → `.github/instructions/packages.instructions.md`
   - Terraform-specific → `.github/instructions/terraform.instructions.md`

2. **When asked to remember an approach:**
   - Document it in the relevant instruction file
   - Ensure it's verifiable (command or file reference)
   - Add to task completion checklist if it's a new verification step

This ensures rules persist across sessions and are enforced consistently.

**Enforcement:** This is a non-negotiable requirement. Failing to update instructions breaks continuity.

---

## Path-Specific Instructions

Detailed rules for each domain are in:

- `.github/instructions/apps.instructions.md` — Apps/Services
- `.github/instructions/packages.instructions.md` — Packages (common/domain/infra)
- `.github/instructions/terraform.instructions.md` — Infrastructure

These are loaded automatically based on the file path you're working in.

---

## Branding Rules

Branding is treated as a repository-level invariant, not a creative playground.

- Branding assets are immutable outside `docs/assets/branding/`.
- All logos and icons MUST be generated using prompts in `docs/assets/branding/prompts/`.
- LLMs must refuse to generate logos or icons outside the defined branding prompts.
- Requests for ad-hoc branding must be rejected.
- Visual consistency is a hard repository rule.
- No branding files are allowed in `apps/`, `packages/`, or repository root.
- No images may be embedded directly in any README.

Violations:

- ❌ Creating branding assets outside `docs/assets/branding/exports/`
- ❌ Generating logos/icons without using official prompts
- ❌ Ad-hoc or experimental branding requests
- ❌ Embedding images directly in READMEs

## WhatsApp Integration Rules

WhatsApp Business Cloud API integration follows strict credential handling:

- **No ad-hoc credentials** in code or docs - all WhatsApp tokens/secrets use PRAXOS\_\* naming
- **All setup instructions** live in `docs/setup/07-whatsapp-business-cloud-api.md`
- **Secrets in production** use Secret Manager (PRAXOS*WHATSAPP*\* prefix)
- **Local** uses `.env` with minimal required variables only

Required secrets (Terraform creates, user populates):

| Secret                            | Purpose                      |
| --------------------------------- | ---------------------------- |
| `PRAXOS_WHATSAPP_VERIFY_TOKEN`    | Webhook verification         |
| `PRAXOS_WHATSAPP_ACCESS_TOKEN`    | API authentication           |
| `PRAXOS_WHATSAPP_PHONE_NUMBER_ID` | Sender identification        |
| `PRAXOS_WHATSAPP_WABA_ID`         | Business account ID          |
| `PRAXOS_WHATSAPP_APP_SECRET`      | Webhook signature validation |

Violations:

- ❌ Hardcoding WhatsApp tokens anywhere
- ❌ Creating WhatsApp setup docs outside `docs/setup/`
- ❌ Using non-PRAXOS\_\* secret names for WhatsApp
- ❌ Committing `.env` files with real credentials

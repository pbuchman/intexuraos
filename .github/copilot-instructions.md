# PraxOS — Global Copilot Instructions

These rules apply to **all code changes** in this repository.
Path-specific rules are in `.github/instructions/*.instructions.md`.

---

## Repository Structure

```
praxos/
├── apps/                    # Deployable services (Fastify)
│   ├── auth-service/
│   └── notion-gpt-service/
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

| Check         | Command                 |
| ------------- | ----------------------- |
| Lint all      | `npm run lint`          |
| Format check  | `npm run format:check`  |
| Typecheck all | `npm run typecheck`     |
| Test all      | `npm run test`          |
| Coverage      | `npm run test:coverage` |
| Build all     | `npm run build`         |
| Full CI       | `npm run ci`            |

Always finish a task by running `npm run ci` and ensuring it passes.

---

## Task Completion Checklist

**When you finish ANY task, you MUST:**

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run ci` passes
- [ ] No new warnings introduced
- [ ] Changes to logic have corresponding tests
- [ ] Path-specific checklist completed (see `.github/instructions/*.instructions.md`)

**Do not claim "done" until verified.**

---

## Honesty Rules

- Do not claim work is complete unless it actually is.
- Do not bluff about coverage or correctness.
- If ambiguous: make a reasonable decision and document it.

---

## Instruction Maintenance

**When a new rule is established during a session:**

If user enforces a new rule (e.g., "always run `npm install` after changing `package.json`"), immediately add it to the appropriate instruction file:

- Global rules → `.github/copilot-instructions.md`
- Apps-specific → `.github/instructions/apps.instructions.md`
- Packages-specific → `.github/instructions/packages.instructions.md`
- Terraform-specific → `.github/instructions/terraform.instructions.md`

This ensures rules persist across sessions and are enforced consistently.

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
- **Local development** uses `.env` with minimal required variables only

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

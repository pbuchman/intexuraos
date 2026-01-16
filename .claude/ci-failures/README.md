# CI Failures Tracking

This directory stores CI failure data for LLM learning purposes.

## How It Works

1. **`pnpm run ci:tracked`** runs CI and appends failures to `{project}-{branch}.jsonl`
2. **`pnpm run ci:report`** generates aggregated failure statistics
3. Each project/branch combo has its own file to avoid merge conflicts

## Feedback Loop — `/analyze-ci-failures`

Periodically (e.g., after 50+ failures collected), run this workflow:

1. **Analyze logs** — Read all `.jsonl` files, group by error code
2. **Identify top patterns** — Focus on top 4-5 most frequent errors
3. **Update CLAUDE.md** — Add/update "Common LLM Mistakes" section with examples
4. **Update this README** — Add changelog entry
5. **Clear history** — Delete `.jsonl` files to start fresh

This creates a continuous improvement loop where LLM learns from its own mistakes.

## File Naming

Files are named `{project}-{branch}.jsonl`:

- `intexuraos-2-development.jsonl` — intexuraos-2 project, development branch
- `intexuraos-2-feature-xyz.jsonl` — intexuraos-2 project, feature-xyz branch

## File Format

Each line is a JSON object representing one CI run:

```json
{
  "ts": "2026-01-09T22:15:00Z",
  "project": "intexuraos-2",
  "branch": "feature-xyz",
  "runNumber": 1,
  "passed": false,
  "durationMs": 45000,
  "failureCount": 3,
  "failures": [
    {
      "type": "typecheck",
      "code": "TS2322",
      "file": "src/foo.ts",
      "line": 45,
      "message": "Type 'string | undefined' is not assignable...",
      "snippet": "const userId: string = request.query.id;",
      "context": "..."
    }
  ]
}
```

## Key Metrics

- **runNumber: 1** = First attempt (what LLM generated initially)
- **runNumber: 2+** = After fixes (shows iteration count)

## Commands

```bash
pnpm run ci:tracked           # Run CI with tracking
pnpm run ci:report            # Full report (last 30 days)
pnpm run ci:report -- --first-run  # First-run failures only
pnpm run ci:report -- --days 7     # Last 7 days
pnpm run ci:report -- --json       # JSON output
```

## Git Behavior

- `*.jsonl` files are tracked in git (shared learning data)
- Each branch writes to its own file (no merge conflicts)

---

## Changelog

### 2026-01-11 — Initial Analysis

**Data analyzed:** 115 CI runs across 6 branch files

**Top errors identified:**
| Error | Count | Category |
|-------|-------|----------|
| ESM imports without `.js` | 26 | TypeScript |
| ServiceContainer mismatches | 20 | TypeScript |
| exactOptionalPropertyTypes | 15 | TypeScript |
| Template literal types | 9 | ESLint |

**Actions taken:**

1. Added "Test-First Development (MANDATORY)" section to CLAUDE.md
2. Added "Common LLM Mistakes" section with top 4 patterns + examples
3. Updated "Web App Exception" with test requirements for logic code
4. Cleared all `.jsonl` files to start fresh collection

**Result:** Instructions now address 80% of historical CI failures

### 2026-01-15 — Unsafe Type Operations Analysis

**Data analyzed:** 432 CI runs across 33 branch files

**Top errors identified:**
| Error | Count | Category |
|-------|-------|----------|
| @typescript-eslint/no-unsafe-member-access | 226 | lint |
| @typescript-eslint/no-unsafe-call | 169 | lint |
| @typescript-eslint/strict-template-expressions | 135 | lint |
| @typescript-eslint/no-unsafe-assignment | 100 | lint |
| TS2322 (type incompatibility) | 99 | typecheck |
| TS2307 (module not found) | 64 | typecheck |
| TS2345 (readonly arrays) | 63 | typecheck |

**Actions taken:**

1. Added pattern #5: "Unsafe Type Operations — Add explicit type assertions"
2. Added pattern #6: "Async Template Expressions — Await or wrap in String()"

**Result:** Added 2 new patterns addressing 630+ lint failures

### 2026-01-15 — Mock Logger & Empty Functions Analysis

**Data analyzed:** 213 CI runs across 16 branch files

**Top errors identified:**
| Error | Count | Category |
| ------------------------------------------- | ----- | --------- |
| @typescript-eslint/no-unsafe-member-access | 552 | lint |
| @typescript-eslint/no-unsafe-assignment | 384 | lint |
| @typescript-eslint/no-unsafe-call | 312 | lint |
| TS2345 (argument type mismatch) | 100 | typecheck |
| @typescript-eslint/no-empty-function | 90 | lint |

**Actions taken:**

1. Expanded pattern #5 "Unsafe Type Operations" with Result narrowing and enum resolution examples
2. Added pattern #6 "Mock Logger — Include ALL required methods" (info, warn, error, debug)
3. Added pattern #7 "Empty Functions in Mocks — Use arrow functions"
4. Renumbered pattern #8 "Async Template Expressions"

**Result:** Added 3 new/expanded patterns addressing 1,438 lint + typecheck failures

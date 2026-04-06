# Coverage Exemptions

**RULE:** `v8 ignore` is a LAST RESORT, not a shortcut. Always write a test first.

**Before adding ANY v8 ignore comment, you MUST:**

1. Write a test that exercises the branch
2. Confirm the branch is **genuinely untestable** (not just inconvenient)
3. Verify the category matches a canonical pattern from the list below

## NEVER Valid for v8 ignore — ALWAYS Testable

| Pattern              | How to Test It                          |
| -------------------- | --------------------------------------- |
| Catch blocks         | Throw in the test (mock the dependency) |
| Error paths          | Mock the dependency to return an error  |
| Validation branches  | Pass invalid input                      |
| Conditional returns  | Test both branches with different input |
| If/else branches     | Test both conditions                    |
| Default switch cases | Pass an unmatched value                 |
| Null guards          | Pass null/undefined input               |

## Valid Categories

`ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Validation:** `pnpm run verify:v8-ignore` (runs in CI Static Validation phase)

**Hook-enforced:** Adding `v8 ignore` triggers a PostToolUse soft-block reminder.

**NEVER** add v8 ignore comments without a valid category. CI will fail.

## Explanation Quality (CI + Hook enforced)

The `--` explanation must name WHY testing is impossible, not WHAT the code does.

| BAD (describes code)                          | GOOD (names blocker)                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| error handling for failed request             | FakeHttpClient cannot simulate AbortError                              |
| optional field check for linearIssueId        | noUncheckedIndexedAccess requires fallback despite prior .length check |
| conditional requires specific webhook payload | test mock always returns status='completed', no 'failed' path          |
| creates type narrowing branch                 | TypeScript cannot narrow string union after switch exhaustiveness      |
| auth validation branch                        | FakeAuthPlugin always returns valid user, cannot simulate null         |

Rule: If you can write a mock/fake to trigger the branch, it's not a valid v8 ignore.

**Blocker keywords** — explanation must contain at least one keyword from the enforced list. See "Blocker Keyword Enforcement" section below for the complete specification.

## Blocker Keyword Enforcement (CI-enforced)

The validation script (Phase B-1) enforces that every v8 ignore explanation contains at least one blocker keyword. This prevents descriptions that merely describe code behavior instead of naming the testing blocker.

**Universal blocker keywords** (accepted for all categories):
`cannot`, `unable`, `impossible`, `always returns`, `always succeeds`, `always has`, `always include`, `always provided`, `always defined`, `no support`, `not mockable`, `not reachable`, `not unit-testable`, `not tracked`, `never triggered`, `no way to`, `does not expose`, `unreachable`, `false positive`, `guarantees`, `guard`, `guaranteed`, `fallback`, `defensive`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `narrows`, `narrowing`

**Category-specific keywords** (accepted only for the listed category):

- `ts-type`: `type check`, `type narrowing`, `undefined check`, `null check`, `type system`, `nullish coalescing`, `optional property`, `spread`, `conditional`, `ternary`
- `module-init`: `bootstrap`, `entry point`, `cold start`, `module load`, `startup`, `initialized at`, `ESM import`
- `source-map`: `alignment`, `misattributed` (note: `false positive` already in universal list)
- `upstream`: `prior check`, `early return`, `validated`, `passthrough` (note: `defensive` already in universal list)
- `schema`: `Zod`, `Fastify schema`, `validation`
- `regex`: `capture group`, `regex match`

Rationalizing? See `.claude/reference/rationalization-traps.md` > V8 Ignore Traps.

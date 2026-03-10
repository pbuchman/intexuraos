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

**Blocker keywords** — explanation should contain at least one: `cannot`, `unable`, `impossible`, `always returns`, `always succeeds`, `no support`, `not mockable`, `not reachable`, `never triggered`, `no way to`, `does not expose`.

## Override Mechanism

Blocks that fail tightened validation but have planned fixes are tracked in `v8-ignore-overrides.json` at repo root, keyed by Linear task ID. The CI script skips validation for files listed under an override entry. Run `pnpm run verify:v8-ignore -- --no-overrides` for strict auditing.

**Reference:** `.claude/skills/coverage/reference/canonical-categories.md`

Rationalizing? See `.claude/reference/rationalization-traps.md` > V8 Ignore Traps.

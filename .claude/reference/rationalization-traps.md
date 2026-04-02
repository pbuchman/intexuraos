# Rationalization Traps Reference

Common thought patterns that precede rule violations. When you catch yourself thinking any of these, STOP.

---

## Commit & CI Traps

| Your Thought                                  | Reality                            |
| --------------------------------------------- | ---------------------------------- |
| "CI failed but my code passes"                | CI failed. No commit.              |
| "The failure is in OTHER services"            | OTHER = forbidden. You own it.     |
| "Global CI fails, but X-specific checks pass" | This phrase has caused violations. |
| "Let me commit anyway and note the CI status" | NO. Fix first, then commit.        |

## Linear State Traps

| Your Thought                                  | Reality                                |
| --------------------------------------------- | -------------------------------------- |
| "The PR is merged, so it's obviously done"    | Merged ≠ Done. Hook blocks it.         |
| "All child issues are complete"               | Complete ≠ Done. User confirms.        |
| "This is just bookkeeping, I'll mark it done" | Bookkeeping requires permission.       |
| "Ready for QA, let me move it there"          | QA is beyond agent scope. Hook blocks. |

## Ownership Traps

| Your Thought                    | Reality                        |
| ------------------------------- | ------------------------------ |
| "pre-existing issue/bug"        | Discovery = ownership          |
| "not my fault/responsibility"   | Fault irrelevant; fix is yours |
| "legacy issue"                  | Legacy = code awaiting owner   |
| **"OTHER services/workspaces"** | No "other" in CI               |
| **"my code/part passes"**       | CI passes or doesn't           |

## Evidence Traps

| Your Thought                               | Reality                                       |
| ------------------------------------------ | --------------------------------------------- |
| "This should work now"                     | Run it. Show output. Then claim.              |
| "I added the import so it will resolve"    | Run typecheck. Show zero errors. Then claim.  |
| "This was likely caused by X"              | Show stack trace or reproduction. Then claim. |
| "Based on my understanding, this fixes it" | Understanding is not evidence. Run it.        |

## V8 Ignore Traps

| Your Thought                                          | Reality                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| "This catch block is untestable"                      | Throw in the test. Catches are always testable.     |
| "The error path is hard to reach"                     | Mock the dependency to return an error.             |
| "This is just a safety guard, it never actually runs" | If it never runs, remove it. If it might, test it.  |
| "I'll add v8 ignore now and write tests later"        | Later never comes. Write the test now.              |
| "This is a test-infra limitation"                     | Is it really? Or is the mock just missing a method? |
| "The validation branch is obvious"                    | Obvious branches still need test coverage.          |
| "It's just a default case in a switch"                | Pass an unmatched value. One line of test code.     |
| "upstream: a prior check makes this unreachable"      | Unreachable code should be deleted, not exempted.   |
| "The explanation is just for documentation"           | Explanation is for VALIDATION. CI checks it.        |
| "This path requires a specific payload"               | Then create that payload in the test.               |

## Investigation Traps

| Your Thought                                        | Reality                                                   |
| --------------------------------------------------- | --------------------------------------------------------- |
| "The CLI segfaults, this is an upstream tool bug"   | Investigate the environment. Tool + environment = yours.  |
| "I found the root cause" (at the first layer)       | Go deeper. Surface cause hides the real root cause.       |
| "The architecture is mismatched, that's the answer" | Why is it mismatched? What built it wrong? Fix that.      |
| "I've diagnosed the problem"                        | Diagnosis without fix is incomplete. Implement the fix.   |
| "Should I rebuild the image?"                       | During incident triage, act. Don't ask permission.        |
| "This crashes because X" (no evidence cited)        | Show the evidence. Stack trace, log line, or config.      |
| Speculating about internal mechanisms               | Citation needed. Reproduce it or don't claim it.          |
| "I'll present findings and let the user decide"     | Implement the fix yourself. Present results, not options. |

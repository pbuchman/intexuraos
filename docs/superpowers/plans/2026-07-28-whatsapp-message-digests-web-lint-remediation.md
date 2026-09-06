# WhatsApp Message Digests — Web Lint Remediation

**Goal:** Restore the tracked Web workspace gate without weakening the same-origin auth return-path boundary used by Message Digest deep links.

**Observed failure:** `pnpm run verify:workspace:tracked web` passed source typecheck and failed lint only at `authReturnPath.ts` because ESLint `no-control-regex` rejects the explicit C0/DEL regular expression.

## Sequential TDD plan

1. Extend `authReturnPath.test.ts` with explicit tab, newline, NUL, unit-separator, and DEL cases. Observe the focused suite remain GREEN against the existing secure behavior; these are characterization tests required before the mechanical lint repair.
2. Replace the lint-rejected regular expression with a small code-point predicate covering exactly U+0000–U+001F and U+007F. Do not change any other allow/deny rule.
3. Run the focused auth-return-path test and targeted lint for the changed files.
4. Rerun `pnpm run verify:workspace:tracked web` once. Continue to the remaining Task 7 convergence gates only after exit code 0.

No production behavior, API contract, deployment configuration, or Mobile Notifications code is changed by this remediation.

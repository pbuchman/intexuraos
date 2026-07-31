# WhatsApp Message Digests — Hash Router Verifier Remediation

> Status: complete — verifier, focused router/editor tests, typecheck, lint, format, and diff checks
> are green; no full CI was run.

## Goal

Restore the hash-routing repository gate without removing the data-router boundary required by the
Message Digest unsaved-changes UX.

## Evidence and root cause

- `pnpm run verify:hash-routing` is RED because it recognizes only a `HashRouter` import and a
  `<HashRouter>` JSX element.
- `apps/web/src/App.tsx` uses `createHashRouter` together with `RouterProvider`, so navigation still
  uses URL hashes and remains compatible with static hosting.
- Message Digest create/edit pages use React Router's `useBlocker`, which requires a data router;
  reverting to declarative `HashRouter` would break the verified discard-unsaved-changes flow.
- No `BrowserRouter` or `createBrowserRouter` is present in Web production source.

## Constraints

- Preserve `createHashRouter`, `RouterProvider`, deep links, and the unsaved-changes dialog.
- Continue to reject both declarative and data variants of browser-history routing.
- Do not weaken the GCS/static-hosting hash-routing requirement.
- Run only the focused verifier/test/type/lint/format evidence here; do not run full CI.

## Implementation

1. Add a focused verifier test that accepts both supported hash-router forms, rejects incomplete
   data-router wiring, and rejects browser-history routers.
2. Refactor `verify-hash-routing.mjs` to expose a side-effect-free analyzer and recognize either:
   `HashRouter` JSX, or `createHashRouter` wired through `RouterProvider`.
3. Update the verifier documentation to describe the hash-routing contract rather than one React
   component spelling.
4. Run the focused test, `verify:hash-routing`, relevant Web editor/router tests, lint, Prettier,
   typecheck, and `git diff --check`.

## Completion gate

The verifier is GREEN for the production `App.tsx`; focused tests prove it rejects browser-history
routing and incomplete wiring; Message Digest navigation-blocker tests remain GREEN; no full CI has
run.

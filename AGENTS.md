# IntexuraOS

## Work safely

- Never commit directly to `development` or `main`; use a `codex/` branch unless the user specifies another branch.
- Do not use Git worktrees in this repository.
- Preserve unrelated user changes and never discard files you did not create.
- Do not mutate Linear issues, external services, deployments, or persistent data unless the user explicitly asks.

## Verify changes

- For a changed workspace, run `pnpm run verify:workspace:tracked <workspace>`.
- Before a commit or pull request, run `pnpm run ci:tracked`.
- Do not weaken tests, coverage thresholds, lint rules, or verification scripts to make a change pass.

## Repository invariants

- Manage persistent infrastructure through Terraform; do not create it directly with cloud CLIs.
- Treat committed migrations as immutable and keep local, dev, and production Firestore data persistent.
- Keep HTTP handlers thin and preserve package boundaries and established error/response contracts.
- Never log secrets, credentials, authorization headers, or raw sensitive payloads.

## Use local context

- Read the nearest `README.md`, package manifest, tests, and implementation before changing a subsystem.
- Follow task-specific skills when their trigger matches; skills add workflow detail but do not override this file.
- When rules and executable behavior disagree, verify the behavior and update the stale rule in the same change.

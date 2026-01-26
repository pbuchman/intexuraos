# Coverage Analysis Reference

## Required Pattern

1. Run tests with JSON reporter:
   ```bash
   pnpm run test:coverage --coverage.reporter=json-summary
   ```

2. Parse with jq:
   ```bash
   # Total coverage
   jq '.total.branches.pct' coverage/coverage-summary.json

   # Files below threshold
   jq -r 'to_entries[]
     | select(.key != "total")
     | select(.value.branches.pct < 100)
     | "\(.key): \(.value.branches.pct)%"' coverage/coverage-summary.json
   ```

## FORBIDDEN

- `vitest --coverage | grep`
- `coverage | tail`
- `grep` on any coverage output

## Why

- grep causes truncation (>30k chars)
- Text parsing breaks on table formatting
- JSON is structured and reliable

## Hook Enforcement

This pattern is enforced by `.claude/hooks/validate-coverage-commands.sh`

Violations will be blocked with a helpful error message showing the correct approach.

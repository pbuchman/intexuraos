# CI Failures Tracking

This directory stores CI failure data for LLM learning purposes.

## How It Works

1. **`npm run ci:tracked`** runs CI and appends failures to `{project}-{branch}.jsonl`
2. **`npm run ci:report`** generates aggregated failure statistics
3. Each project/branch combo has its own file to avoid merge conflicts

## File Naming

Files are named `{project}-{branch}.jsonl`:
- `intexuraos-2-development.jsonl` - intexuraos-2 project, development branch
- `intexuraos-2-feature-xyz.jsonl` - intexuraos-2 project, feature-xyz branch

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
npm run ci:tracked           # Run CI with tracking
npm run ci:report            # Full report (last 30 days)
npm run ci:report -- --first-run  # First-run failures only
npm run ci:report -- --days 7     # Last 7 days
npm run ci:report -- --json       # JSON output
```

## Git Behavior

- `*.jsonl` files are tracked in git (shared learning data)
- Each branch writes to its own file (no merge conflicts)

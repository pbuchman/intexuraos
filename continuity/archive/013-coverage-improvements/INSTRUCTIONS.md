# Coverage Improvements — Process Manual

## Goal

Improve branch coverage to ≥90% for 5 files identified in GitHub issues #240-#244.

## Success Criteria

- All target files have branch coverage ≥90%
- All tests pass
- `npm run ci` passes
- Issues closed with coverage proof

## Subtask Numbering

```
0-0-diagnostics.md     ← Tier 0: Initial coverage baseline
1-0-notion-ts.md       ← Tier 1: #240 - notion.ts (34.48% → 90%)
1-1-health-ts.md       ← Tier 1: #241 - health.ts (85.71% → 90%)
1-2-notion-connection.md ← Tier 1: #242 - notionConnection.ts (85.71% → 90%)
1-3-refresh-token.md   ← Tier 1: #243 - refreshAccessToken.ts (87.5% → 90%)
1-4-integration-routes.md ← Tier 1: #244 - integrationRoutes.ts (87.5% → 90%)
2-0-verification.md    ← Tier 2: Final verification and archival
```

## Idempotent Execution

1. Read `CONTINUITY.md` to determine current state
2. Resume from `Now` task
3. After each subtask, update `Done` → `Now` → `Next`
4. Never overwrite ledger; append deltas

## Verification Commands

```bash
npm run test:coverage 2>&1 | grep -E "filename\.ts"
npm run ci
```

## Resume Procedure

1. Read `CONTINUITY.md`
2. Check `Now` field for current task
3. Continue execution from that point

# Migration 105 Research Cost Reconciliation

Migration `105_reconcile-research-usage-costs.mjs` backfills completed research documents whose `totalCostUsd` is zero from `llm_usage_events` that already have `correlation.researchId`.

## Automatic Path

Run pending migrations:

```bash
pnpm run migrate
```

The migration updates only completed researches with zero cost. It skips researches that already have a nonzero `totalCostUsd`, skips usage events whose `owner.id` does not match the research `userId`, and leaves null-correlation usage events untouched.

## Manual Path For Null-Correlation Events

Some historical usage events were emitted before research correlation was wired end-to-end. Those events cannot be safely joined by migration code.

For each affected research:

1. Identify candidate `llm_usage_events` by `owner.id`, time window, model, service/component, and known execution logs.
2. Verify the events belong to the research. Do not infer solely from timestamp proximity.
3. Patch the verified events with `correlation.researchId`.
4. Re-run migration 105 in the target environment, or manually set `researches/{researchId}.totalCostUsd`, `totalInputTokens`, and `totalOutputTokens` from the verified event totals.
5. Record the event ids and operator notes in the incident or Linear issue before closing the repair.

Never assign null-correlation events to a research without an auditable source tying them to that research.

/**
 * Migration 105: Reconcile research totals from attributed usage events
 *
 * Backfills completed research documents whose `totalCostUsd` is still zero
 * from llm_usage_events that carry `correlation.researchId`. Historical events
 * without research correlation are intentionally not guessed here; see the
 * runbook next to this migration for the manual repair path.
 */

export const metadata = {
  id: '105',
  name: 'reconcile-research-usage-costs',
  description: 'Backfill zero research totals from correlated llm_usage_events',
  createdAt: '2026-05-06',
};

export const indexes = [];

export const rules = {};

const MIGRATION_ID = '105';

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getByPath(data, path) {
  return path.split('.').reduce((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    return current[segment];
  }, data);
}

function ownerMatchesResearch(eventData, researchData) {
  const researchUserId = researchData.userId;
  if (typeof researchUserId !== 'string' || researchUserId.length === 0) {
    return true;
  }
  return getByPath(eventData, 'owner.id') === researchUserId;
}

function addEventToTotals(totals, eventData) {
  const cost = eventData.cost ?? {};
  const usage = eventData.usage ?? {};

  totals.eventCount += 1;
  totals.totalCostUsd += numberOrZero(cost.billedUsd);
  totals.totalInputTokens += numberOrZero(usage.inputTokens);
  totals.totalOutputTokens += numberOrZero(usage.outputTokens);
  totals.totalTokens += numberOrZero(usage.totalTokens);
  totals.imageCount += numberOrZero(usage.imageCount);
}

async function summarizeUsageEvents(firestore, researchId, researchData) {
  const snapshot = await firestore
    .collection('llm_usage_events')
    .where('correlation.researchId', '==', researchId)
    .get();

  const totals = {
    eventCount: 0,
    skippedOwnerMismatch: 0,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    imageCount: 0,
  };

  for (const eventDoc of snapshot.docs) {
    const eventData = eventDoc.data();
    if (!ownerMatchesResearch(eventData, researchData)) {
      totals.skippedOwnerMismatch += 1;
      continue;
    }
    addEventToTotals(totals, eventData);
  }

  return totals;
}

export async function reconcileResearchUsageCosts(context) {
  console.log('  Reconciling completed research costs from llm_usage_events...');

  const researchSnapshot = await context.firestore
    .collection('researches')
    .where('status', '==', 'completed')
    .get();

  const result = {
    scanned: 0,
    updated: 0,
    skippedNonZeroCost: 0,
    skippedNoAttributedCost: 0,
    skippedOwnerMismatchEvents: 0,
  };

  for (const researchDoc of researchSnapshot.docs) {
    result.scanned += 1;

    const research = researchDoc.data();
    if (numberOrZero(research.totalCostUsd) > 0) {
      result.skippedNonZeroCost += 1;
      continue;
    }

    const researchId = research.id ?? researchDoc.id;
    const totals = await summarizeUsageEvents(context.firestore, researchId, research);
    result.skippedOwnerMismatchEvents += totals.skippedOwnerMismatch;

    if (totals.totalCostUsd <= 0) {
      result.skippedNoAttributedCost += 1;
      continue;
    }

    await researchDoc.ref.update({
      totalCostUsd: totals.totalCostUsd,
      totalInputTokens: totals.totalInputTokens,
      totalOutputTokens: totals.totalOutputTokens,
      usageCostReconciledAt: new Date().toISOString(),
      usageCostReconciliation: {
        migrationId: MIGRATION_ID,
        eventCount: totals.eventCount,
        totalTokens: totals.totalTokens,
        imageCount: totals.imageCount,
        skippedOwnerMismatchEvents: totals.skippedOwnerMismatch,
      },
    });
    result.updated += 1;
  }

  console.log(
    `  Reconciled ${String(result.updated)} of ${String(result.scanned)} completed researches`
  );
  return result;
}

export async function up(context) {
  return await reconcileResearchUsageCosts(context);
}

export async function down(_context) {
  // Forward-only data reconciliation. No automatic rollback.
}

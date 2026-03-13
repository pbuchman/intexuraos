/**
 * Migration 059: Remove ZAI/GLM-4.7 and finalize GLM-5
 * Cache-bust: 2026-03-12T00:00:00Z
 *
 * This migration:
 * 1. Removes ZAI API keys and test results from user_settings
 * 2. Changes default model from GLM-4.7/GLM-4.7-flash to gemini-2.5-flash
 * 3. Deletes zai provider from llm_pricing
 * 4. Cleans up GLM-4.7 references from researches
 */

import { FieldValue } from 'firebase-admin/firestore';

export const metadata = {
  id: '059',
  name: 'remove-zai-and-finalize-glm5',
  description: 'Remove ZAI/GLM-4.7 from user settings, code tasks, and researches',
  createdAt: '2026-03-12',
};

/**
 * Models to migrate away from (deprecated)
 */
const DEPRECATED_GL_MODELS = ['glm-4.7', 'glm-4.7-flash'];

/**
 * Migration target model
 */
const TARGET_MODEL = 'gemini-2.5-flash';

/**
 * Process user_settings collection
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
async function migrateUserSettings(context) {
  console.log('  Processing user_settings collection...');

  const db = context.firestore;
  const snapshot = await db.collection('user_settings').get();

  console.log(`  Found ${snapshot.size} user_settings documents`);

  if (snapshot.size === 0) {
    console.log('  No user_settings documents to process.');
    return { userSettingsModified: 0 };
  }

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let docsProcessed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    // Remove llmApiKeys.zai if exists
    if (data.llmApiKeys !== undefined && 'zai' in data.llmApiKeys) {
      updates['llmApiKeys.zai'] = FieldValue.delete();
      count++;
    }

    // Remove llmTestResults.zai if exists
    if (data.llmTestResults !== undefined && 'zai' in data.llmTestResults) {
      updates['llmTestResults.zai'] = FieldValue.delete();
      count++;
    }

    // Change defaultModel if it's glm-4.7 or glm-4.7-flash
    if (
      data.llmPreferences !== undefined &&
      data.llmPreferences.defaultModel !== undefined &&
      DEPRECATED_GL_MODELS.includes(data.llmPreferences.defaultModel)
    ) {
      updates['llmPreferences.defaultModel'] = TARGET_MODEL;
      count++;
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);

      if (count % BATCH_SIZE === 0) {
        await batch.commit();
        console.log(`  Committed batch of ${BATCH_SIZE} (${count} modifications)`);
        batch = db.batch();
      }
    }

    docsProcessed++;
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit();
  }

  console.log(
    `  User settings migration complete: ${count} modifications out of ${docsProcessed} documents`
  );

  return { userSettingsModified: count };
}

/**
 * Process code_tasks collection
 *
 * Note: 'glm' is the canonical CodeTaskWorkerType (defined in common-core).
 * No rename is needed — existing code_tasks with workerType 'glm' are already correct.
 * The orchestrator maps 'glm' to the GLM-5 model at runtime.
 *
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
async function migrateCodeTasks(_context) {
  console.log('  Processing code_tasks collection...');
  console.log('  No code_tasks migration needed — glm is the canonical worker type.');
  return { codeTasksModified: 0 };
}

/**
 * Delete zai provider from llm_pricing
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
async function deleteZaiPricing(context) {
  console.log('  Deleting zai provider from llm_pricing...');

  const db = context.firestore;
  const zaiDocRef = db.doc('settings/llm_pricing/providers/zai');

  const doc = await zaiDocRef.get();

  if (!doc.exists) {
    console.log('  zai provider document does not exist, skipping deletion.');
    return { zaiPricingDeleted: false };
  }

  await zaiDocRef.delete();
  console.log('  Deleted zai provider document');

  return { zaiPricingDeleted: true };
}

/**
 * Process researches collection
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
async function migrateResearches(context) {
  console.log('  Processing researches collection...');

  const db = context.firestore;
  const snapshot = await db.collection('researches').get();

  console.log(`  Found ${snapshot.size} research documents`);

  if (snapshot.size === 0) {
    console.log('  No research documents to process.');
    return { researchesModified: 0, researchesDeleted: 0 };
  }

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let deleteCount = 0;
  let docsProcessed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};
    let shouldDelete = false;

    // Remove GLM-4.7 from selectedModels array
    if (data.selectedModels !== undefined && Array.isArray(data.selectedModels)) {
      const filteredModels = data.selectedModels.filter(
        (model) => !DEPRECATED_GL_MODELS.includes(model)
      );
      if (filteredModels.length !== data.selectedModels.length) {
        if (filteredModels.length === 0) {
          // Delete research if no models remain
          shouldDelete = true;
        } else {
          updates.selectedModels = filteredModels;
        }
      }
    }

    // Remove GLM-4.7 from llmResults
    if (!shouldDelete && data.llmResults !== undefined && Array.isArray(data.llmResults)) {
      const filteredResults = data.llmResults.filter(
        (result) => result.model && !DEPRECATED_GL_MODELS.includes(result.model)
      );
      if (filteredResults.length !== data.llmResults.length) {
        updates.llmResults = filteredResults;
      }
    }

    // Reassign synthesisModel if it was GLM-4.7
    if (!shouldDelete && data.synthesisModel !== undefined) {
      if (DEPRECATED_GL_MODELS.includes(data.synthesisModel)) {
        // If filtered models remain, reassign synthesisModel to the first remaining model
        const remainingModels = updates.selectedModels ?? data.selectedModels;
        if (Array.isArray(remainingModels) && remainingModels.length > 0) {
          updates.synthesisModel = remainingModels[0];
        } else {
          // No models remain — delete the research
          shouldDelete = true;
        }
      }
    }

    if (shouldDelete) {
      batch.delete(doc.ref);
      deleteCount++;
    } else if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      count++;
    }

    docsProcessed++;

    const opsInBatch = count + deleteCount;
    if (opsInBatch > 0 && opsInBatch % BATCH_SIZE === 0) {
      await batch.commit();
      console.log(`  Committed batch: ${count} modified, ${deleteCount} deleted`);
      batch = db.batch();
    }
  }

  // Commit any remaining operations
  if ((count + deleteCount) % BATCH_SIZE !== 0) {
    await batch.commit();
  }

  console.log(
    `  Researches migration complete: ${count} documents modified, ${deleteCount} documents deleted`
  );

  return { researchesModified: count, researchesDeleted: deleteCount };
}

/**
 * Run the migration
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} context
 */
export async function up(context) {
  console.log('Starting migration 059: Remove ZAI/GLM-4.7 and finalize GLM-5');

  const results = {};

  // 1. Migrate user_settings
  results.userSettings = await migrateUserSettings(context);

  // 2. Migrate code_tasks
  results.codeTasks = await migrateCodeTasks(context);

  // 3. Delete zai pricing
  results.zaiPricing = await deleteZaiPricing(context);

  // 4. Migrate researches
  results.researches = await migrateResearches(context);

  console.log('Migration 059 complete:', results);

  return results;
}

/**
 * No rollback - this is a cleanup migration
 * @param {{ firestore: import('@google-cloud/firestore').Firestore }} _context
 */
export async function down(_context) {
  console.log(
    'Rollback not supported - ZAI/GLM-4.7 removal is a one-way migration. ' +
      'Data must be restored from backup if needed.'
  );
}

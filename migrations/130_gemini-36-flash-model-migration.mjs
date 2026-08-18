/**
 * Migration 130: Replace Gemini 3 Flash Preview with Gemini 3.6 Flash.
 *
 * Runtime compatibility normalizes the retired identifier during rolling
 * deployments. This migration permanently rewrites persisted user and
 * research model selections so the preview model cannot be scheduled again.
 */

export const metadata = {
  id: '130',
  name: 'gemini-36-flash-model-migration',
  description: 'Migrate persisted Gemini 3 Flash Preview identifiers to Gemini 3.6 Flash',
  createdAt: '2026-08-18',
};

const OLD_RAW_MODEL = 'google/gemini-3-flash-preview';
const NEW_RAW_MODEL = 'google/gemini-3.6-flash';
const OLD_OPENROUTER_MODEL = `or:${OLD_RAW_MODEL}`;
const NEW_OPENROUTER_MODEL = `or:${NEW_RAW_MODEL}`;
const BATCH_SIZE = 400;

function migrateModelId(value) {
  if (value === OLD_RAW_MODEL) return NEW_RAW_MODEL;
  if (value === OLD_OPENROUTER_MODEL) return NEW_OPENROUTER_MODEL;
  return value;
}

function migrateModelArray(value) {
  if (!Array.isArray(value)) return { changed: false, value };
  let changed = false;
  const migrated = value.map((model) => {
    const next = migrateModelId(model);
    if (next !== model) changed = true;
    return next;
  });
  return { changed, value: migrated };
}

function migrateLlmResults(value) {
  if (!Array.isArray(value)) return { changed: false, value };
  let changed = false;
  const migrated = value.map((result) => {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      return result;
    }
    const nextModel = migrateModelId(result.model);
    if (nextModel === result.model) return result;
    changed = true;
    return { ...result, model: nextModel };
  });
  return { changed, value: migrated };
}

async function commitIfNeeded(state) {
  if (state.batchOps === 0) return state;
  await state.batch.commit();
  return {
    batch: state.firestore.batch(),
    batchOps: 0,
    firestore: state.firestore,
  };
}

async function migrateUserSettings(firestore) {
  console.log('  Processing user_settings collection for Gemini model IDs...');

  const snapshot = await firestore.collection('user_settings').get();
  if (snapshot.size === 0) {
    console.log('  No user_settings documents to process.');
    return { userSettingsModified: 0 };
  }

  let state = { firestore, batch: firestore.batch(), batchOps: 0 };
  let userSettingsModified = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    for (const field of ['defaultModel', 'fallbackModel', 'intexAgentModel']) {
      const model = data.llmPreferences?.[field];
      const migratedModel = migrateModelId(model);
      if (migratedModel !== model) {
        updates[`llmPreferences.${field}`] = migratedModel;
      }
    }

    if (Object.keys(updates).length > 0) {
      state.batch.update(doc.ref, updates);
      state.batchOps++;
      userSettingsModified++;
    }

    if (state.batchOps >= BATCH_SIZE) {
      state = await commitIfNeeded(state);
    }
  }

  await commitIfNeeded(state);

  console.log(`  User settings migration complete: ${userSettingsModified} modified`);
  return { userSettingsModified };
}

async function migrateResearches(firestore) {
  console.log('  Processing researches collection for Gemini model IDs...');

  const snapshot = await firestore.collection('researches').get();
  if (snapshot.size === 0) {
    console.log('  No researches documents to process.');
    return { researchesModified: 0 };
  }

  let state = { firestore, batch: firestore.batch(), batchOps: 0 };
  let researchesModified = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    const selectedModels = migrateModelArray(data.selectedModels);
    if (selectedModels.changed) {
      updates.selectedModels = selectedModels.value;
    }

    const migratedSynthesisModel = migrateModelId(data.synthesisModel);
    if (migratedSynthesisModel !== data.synthesisModel) {
      updates.synthesisModel = migratedSynthesisModel;
    }

    const llmResults = migrateLlmResults(data.llmResults);
    if (llmResults.changed) {
      updates.llmResults = llmResults.value;
    }

    const failedModels = migrateModelArray(data.partialFailure?.failedModels);
    if (failedModels.changed) {
      updates['partialFailure.failedModels'] = failedModels.value;
    }

    if (Object.keys(updates).length > 0) {
      state.batch.update(doc.ref, updates);
      state.batchOps++;
      researchesModified++;
    }

    if (state.batchOps >= BATCH_SIZE) {
      state = await commitIfNeeded(state);
    }
  }

  await commitIfNeeded(state);

  console.log(`  Researches migration complete: ${researchesModified} modified`);
  return { researchesModified };
}

export async function up(context) {
  console.log('Starting migration 130: Migrate Gemini 3 Flash Preview to Gemini 3.6 Flash');

  const userSettings = await migrateUserSettings(context.firestore);
  const researches = await migrateResearches(context.firestore);

  console.log('Migration 130 complete');
  return { userSettings, researches };
}

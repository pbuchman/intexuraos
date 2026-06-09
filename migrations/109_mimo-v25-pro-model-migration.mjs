/**
 * Migration 109: Migrate legacy MiMo model identifiers to MiMo Pro 2.5.
 *
 * Runtime code now uses:
 *   - Direct Xiaomi Anthropic-compatible model: mimo-v2.5-pro
 *   - OpenRouter model: xiaomi/mimo-v2.5-pro
 *
 * Data migration is limited to persisted user/research model selections.
 * Code task workerType remains `mimo-pro`, which is the stable public preset.
 */

export const metadata = {
  id: '109',
  name: 'mimo-v25-pro-model-migration',
  description: 'Migrate persisted legacy MiMo OpenRouter model identifiers to MiMo Pro 2.5',
  createdAt: '2026-06-09',
};

const OLD_RAW_MODEL = 'xiaomi/mimo-' + 'v2-pro';
const NEW_RAW_MODEL = 'xiaomi/mimo-v2.5-pro';
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
  };
}

async function migrateUserSettings(firestore) {
  console.log('  Processing user_settings collection for MiMo model IDs...');

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

    const defaultModel = data.llmPreferences?.defaultModel;
    const migratedDefaultModel = migrateModelId(defaultModel);
    if (migratedDefaultModel !== defaultModel) {
      updates['llmPreferences.defaultModel'] = migratedDefaultModel;
    }

    const fallbackModel = data.llmPreferences?.fallbackModel;
    const migratedFallbackModel = migrateModelId(fallbackModel);
    if (migratedFallbackModel !== fallbackModel) {
      updates['llmPreferences.fallbackModel'] = migratedFallbackModel;
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

  state = await commitIfNeeded(state);

  console.log(`  User settings migration complete: ${userSettingsModified} modified`);
  return { userSettingsModified };
}

async function migrateResearches(firestore) {
  console.log('  Processing researches collection for MiMo model IDs...');

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

    if (Object.keys(updates).length > 0) {
      state.batch.update(doc.ref, updates);
      state.batchOps++;
      researchesModified++;
    }

    if (state.batchOps >= BATCH_SIZE) {
      state = await commitIfNeeded(state);
    }
  }

  state = await commitIfNeeded(state);

  console.log(`  Researches migration complete: ${researchesModified} modified`);
  return { researchesModified };
}

export async function up(context) {
  console.log('Starting migration 109: Migrate legacy MiMo identifiers to MiMo Pro 2.5');

  const userSettings = await migrateUserSettings(context.firestore);
  const researches = await migrateResearches(context.firestore);

  console.log('Migration 109 complete');
  return { userSettings, researches };
}

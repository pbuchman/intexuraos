/**
 * Migration 025: Add Default LLM Model to User Settings
 * Cache-bust: 2026-01-13T15:00:00Z
 *
 * Adds llmPreferences.defaultModel to all existing user settings.
 * Defaults to 'gemini-2.5-flash' for all users.
 */

export const metadata = {
  id: '025',
  name: 'default-llm-model',
  description: 'Add default LLM model to user settings',
  createdAt: '2026-01-13',
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

export async function up(context) {
  console.log('  Adding default LLM model to all user settings...');

  // Query all user settings documents
  const snapshot = await context.firestore.collection('users').get();

  const batch = context.firestore;
  let processedCount = 0;
  let skippedCount = 0;

  for (const doc of snapshot.docs) {
    const settings = doc.data();
    const userId = doc.id;

    // Skip if already has llmPreferences with defaultModel
    if (settings.llmPreferences?.defaultModel) {
      skippedCount++;
      continue;
    }

    // Add/update llmPreferences with defaultModel
    const existingPrefs = settings.llmPreferences || {};
    const updatedPrefs = {
      ...existingPrefs,
      defaultModel: DEFAULT_MODEL,
    };

    await batch.doc(`users/${userId}`).set(
      {
        llmPreferences: updatedPrefs,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    processedCount++;
  }

  console.log(`  Processed ${processedCount} user settings`);
  if (skippedCount > 0) {
    console.log(`  Skipped ${skippedCount} users (already has defaultModel)`);
  }
  console.log(`  Set default model to: ${DEFAULT_MODEL}`);
}

export async function down(context) {
  // Optional: remove llmPreferences.defaultModel from all users
  console.log('  Removing default LLM model from user settings (down migration not implemented)');
  console.log('  Note: llmPreferences can be left in place safely');
}

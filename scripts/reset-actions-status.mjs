#!/usr/bin/env node
/**
 * Reset Actions Status Script
 *
 * Fetches all actions from Firestore and sets their status to 'pending'.
 * Useful for testing the action processing flow.
 *
 * Usage:
 *   node scripts/reset-actions-status.mjs                    # Reset all actions
 *   node scripts/reset-actions-status.mjs --dry-run          # Preview without applying
 *   node scripts/reset-actions-status.mjs --type research    # Reset only research actions
 *   node scripts/reset-actions-status.mjs --status awaiting_approval  # Reset only awaiting_approval
 *
 * Environment:
 *   FIRESTORE_EMULATOR_HOST - If set, uses emulator
 *   INTEXURAOS_GCP_PROJECT_ID - Target project
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ACTIONS_COLLECTION = 'actions';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    type: null,
    status: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--type' && args[i + 1]) {
      options.type = args[++i];
    } else if (args[i] === '--status' && args[i + 1]) {
      options.status = args[++i];
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log('🔧 Reset Actions Status Script');
  console.log('================================');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - no changes will be made\n');
  }

  // Initialize Firebase Admin
  if (getApps().length === 0) {
    const projectId = process.env.INTEXURAOS_GCP_PROJECT_ID || process.env.GCLOUD_PROJECT;

    if (!projectId) {
      console.error('❌ Error: INTEXURAOS_GCP_PROJECT_ID or GCLOUD_PROJECT must be set');
      process.exit(1);
    }

    console.log(`📁 Project: ${projectId}`);

    if (process.env.FIRESTORE_EMULATOR_HOST) {
      console.log(`🔌 Using emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
      initializeApp({ projectId });
    } else {
      console.log('☁️  Using production Firestore');
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }
  }

  const db = getFirestore();

  // Build query
  let query = db.collection(ACTIONS_COLLECTION);

  if (options.type) {
    console.log(`📋 Filtering by type: ${options.type}`);
    query = query.where('type', '==', options.type);
  }

  if (options.status) {
    console.log(`📋 Filtering by status: ${options.status}`);
    query = query.where('status', '==', options.status);
  }

  console.log('\n🔍 Fetching actions...');

  const snapshot = await query.get();

  if (snapshot.empty) {
    console.log('✅ No actions found matching criteria');
    return;
  }

  console.log(`📊 Found ${snapshot.size} action(s)\n`);

  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const action = doc.data();
    const docId = doc.id;
    const { title, type, status } = action;

    if (status === 'pending') {
      console.log(`⏭️  Skip: ${docId} - "${title}" (${type}) - already pending`);
      skipped++;
      continue;
    }

    console.log(`📝 ${options.dryRun ? '[DRY RUN] ' : ''}Update: ${docId} - "${title}" (${type})`);
    console.log(`   Status: ${status} → pending`);

    if (!options.dryRun) {
      await db.collection(ACTIONS_COLLECTION).doc(docId).update({
        status: 'pending',
        updatedAt: now,
      });
    }

    updated++;
  }

  console.log('\n================================');
  console.log(`✅ Done!`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);

  if (options.dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});


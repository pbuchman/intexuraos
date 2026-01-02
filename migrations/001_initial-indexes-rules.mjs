/**
 * Migration 001: Initial Firestore Indexes and Rules
 *
 * Deploys the baseline Firestore indexes and security rules.
 * Uses Firebase CLI to deploy from firestore.indexes.json and firestore.rules.
 */

export const metadata = {
  id: '001',
  name: 'initial-indexes-rules',
  description: 'Deploy initial Firestore indexes and security rules',
  createdAt: '2026-01-02',
};

export async function up(context) {
  console.log('  Deploying Firestore indexes...');
  await context.deployIndexes();

  console.log('  Deploying Firestore security rules...');
  await context.deployRules();
}

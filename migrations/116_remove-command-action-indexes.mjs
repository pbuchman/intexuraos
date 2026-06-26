/**
 * Migration 116: Remove command/action Firestore artifacts.
 *
 * The command/action agents have been retired. Historical migrations stay
 * immutable, so this cleanup migration removes their generated indexes and
 * rules from the aggregated Firestore deploy artifacts.
 */

export const metadata = {
  id: '116',
  name: 'remove-command-action-indexes',
  description: 'Remove generated Firestore indexes and rules for retired command/action collections',
  createdAt: '2026-06-24',
};

export const indexes = [];

export const removedCollectionGroups = [
  'commands',
  'actions',
  'actions_transitions',
  'approval_messages',
];

export const removedRulePaths = ['commands/{commandId}', 'actions/{actionId}'];

export async function up(context) {
  console.log('  Cleanup migration 116: deploying regenerated Firestore indexes and rules');
  await context.deployIndexes();
  await context.deployRules();
}

/**
 * Migration 122: Redeploy the aggregated Conversation Assistant snapshot index artifact.
 *
 * Migration 119 already declares sessionId ASC, userId ASC, createdAt ASC, __name__ ASC
 * for whatsapp_conversation_assistant_turns. This migration forces a forward-only
 * redeploy of the aggregated Firestore index artifact so the missing composite index
 * is published again.
 */

export const metadata = {
  id: '122',
  name: 'whatsapp-conversation-assistant-snapshot-index-redeploy',
  description: 'Redeploy Firestore indexes for Conversation Assistant session snapshot reads',
  createdAt: '2026-07-05',
};

export const indexes = [];

export async function up(context) {
  console.log(
    '  Redeploying Firestore indexes for Conversation Assistant session snapshot reads...'
  );
  await context.deployIndexes();
}

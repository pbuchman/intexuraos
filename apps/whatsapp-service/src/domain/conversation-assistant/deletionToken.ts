import { createHash } from 'node:crypto';
import type { ConversationAssistantSession } from './types.js';

export function createConversationAssistantDeletionToken(
  session: Pick<ConversationAssistantSession, 'id' | 'createdAt' | 'generationId'>
): string {
  return createHash('sha256')
    .update(`${session.id}\0${session.createdAt}\0${session.generationId ?? 'legacy'}`)
    .digest('hex');
}

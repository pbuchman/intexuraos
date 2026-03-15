/**
 * Repository port for event decisions.
 */

import type { Result } from '@intexuraos/common-core';
import type { EventDecision, CreateEventDecisionInput } from '../models/eventDecision.js';

export interface EventDecisionRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface EventDecisionRepository {
  /**
   * Save an event decision. Uses deterministic ID (ed_${eventId}) for natural deduplication.
   */
  save(input: CreateEventDecisionInput): Promise<Result<EventDecision, EventDecisionRepositoryError>>;
  findByEventIds?(eventIds: string[]): Promise<Result<EventDecision[], EventDecisionRepositoryError>>;
}

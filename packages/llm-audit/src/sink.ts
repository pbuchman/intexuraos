import { getErrorMessage, ok, err, type Logger, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { LlmAuditLog } from './types.js';

const COLLECTION_NAME = 'llm_api_logs';

/**
 * Sink contract for persisting audit events.
 */
export interface AuditSink {
  save(log: LlmAuditLog): Promise<Result<void>>;
}

/**
 * Default sink that persists audit logs to Firestore.
 */
export class FirestoreAuditSink implements AuditSink {
  async save(log: LlmAuditLog): Promise<Result<void>> {
    try {
      const firestore = getFirestore();
      await firestore.collection(COLLECTION_NAME).doc(log.id).set(log);
      return ok(undefined);
    } catch (error) {
      return err(new Error(getErrorMessage(error)));
    }
  }
}

/**
 * Sink that emits audit payloads to structured logs instead of Firestore.
 */
export class StructuredLogAuditSink implements AuditSink {
  readonly logger: Logger;

  constructor(deps: { logger: Logger }) {
    this.logger = deps.logger;
  }

  save(log: LlmAuditLog): Promise<Result<void>> {
    this.logger.info({ audit: log }, 'LLM audit log');
    return Promise.resolve(ok(undefined));
  }
}

/**
 * Sink that discards all audit events.
 */
export class NoopAuditSink implements AuditSink {
  save(): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }
}

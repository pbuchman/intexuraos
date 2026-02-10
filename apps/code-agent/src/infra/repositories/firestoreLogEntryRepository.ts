import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { LogEntryRepository, RepositoryError } from '../../domain/repositories/logEntryRepository.js';
import type { LogEntry } from '../../domain/models/logEntry.js';
import type { Firestore } from '@intexuraos/infra-firestore';

export interface FirestoreLogEntryRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreLogEntryRepository implements LogEntryRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreLogEntryRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async storeBatch(taskId: string, entries: LogEntry[]): Promise<Result<void, RepositoryError>> {
    if (entries.length === 0) {
      return ok(undefined);
    }

    const MAX_BATCH_SIZE = 500;

    try {
      for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
        const batch = this.firestore.batch();
        const slice = entries.slice(i, i + MAX_BATCH_SIZE);

        for (const entry of slice) {
          const docRef = this.firestore
            .collection('code_tasks')
            .doc(taskId)
            .collection('log_entries')
            .doc();

          const doc: Record<string, unknown> = {
            sequence: entry.sequence,
            type: entry.type,
            timestamp: entry.timestamp,
          };

          if (entry.systemSubtype !== undefined) doc['systemSubtype'] = entry.systemSubtype;
          if (entry.hookName !== undefined) doc['hookName'] = entry.hookName;
          if (entry.hookExitCode !== undefined) doc['hookExitCode'] = entry.hookExitCode;
          if (entry.hookOutput !== undefined) doc['hookOutput'] = entry.hookOutput;
          if (entry.model !== undefined) doc['model'] = entry.model;
          if (entry.toolCount !== undefined) doc['toolCount'] = entry.toolCount;
          if (entry.mcpServers !== undefined) doc['mcpServers'] = entry.mcpServers;
          if (entry.text !== undefined) doc['text'] = entry.text;
          if (entry.toolName !== undefined) doc['toolName'] = entry.toolName;
          if (entry.toolContext !== undefined) doc['toolContext'] = entry.toolContext;
          if (entry.content !== undefined) doc['content'] = entry.content;
          if (entry.isError !== undefined) doc['isError'] = entry.isError;
          if (entry.resultType !== undefined) doc['resultType'] = entry.resultType;
          if (entry.durationMs !== undefined) doc['durationMs'] = entry.durationMs;
          if (entry.numTurns !== undefined) doc['numTurns'] = entry.numTurns;
          if (entry.totalCostUsd !== undefined) doc['totalCostUsd'] = entry.totalCostUsd;
          if (entry.errorMessage !== undefined) doc['errorMessage'] = entry.errorMessage;
          if (entry.rawText !== undefined) doc['rawText'] = entry.rawText;

          batch.set(docRef, doc);
        }

        await batch.commit();
      }
      this.logger.debug({ taskId, count: entries.length }, 'Stored log entries');
      return ok(undefined);
    /* v8 ignore start -- test-infra: firestorelogentryrepository batch.commit error path @preserve */
    } catch (error) {
    /* v8 ignore stop @preserve */
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to store log entries');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreLogEntryRepository(
  deps: FirestoreLogEntryRepositoryDeps
): LogEntryRepository {
  return new FirestoreLogEntryRepository(deps);
}

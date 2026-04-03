import { randomUUID } from 'node:crypto';
import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';

import type { ExecutionMemoryApplication } from '../../domain/models/executionMemoryApplication.js';
import type {
  CreateExecutionMemoryApplicationInput,
  ExecutionMemoryApplicationRepository,
  ExecutionMemoryApplicationRepositoryError,
  UpdateExecutionMemoryApplicationInput,
} from '../../domain/repositories/executionMemoryApplicationRepository.js';

function getStringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function toExecutionMemoryApplication(doc: {
  id: string;
  data(): Record<string, unknown>;
}): ExecutionMemoryApplication {
  const data = doc.data();
  const perMemoryOutcome = Array.isArray(data['perMemoryOutcome'])
    ? data['perMemoryOutcome'] as ExecutionMemoryApplication['perMemoryOutcome']
    : undefined;
  const completedAt = data['completedAt'] !== undefined
    ? data['completedAt'] as Timestamp
    : undefined;

  return {
    id: doc.id,
    taskId: getStringField(data, 'taskId'),
    repository: getStringField(data, 'repository'),
    ...(typeof data['linearIssueId'] === 'string' ? { linearIssueId: data['linearIssueId'] } : {}),
    querySummary: getStringField(data, 'querySummary'),
    queryText: getStringField(data, 'queryText'),
    queryComponents: Array.isArray(data['queryComponents']) ? data['queryComponents'] as string[] : [],
    queryRiskFlags: Array.isArray(data['queryRiskFlags']) ? data['queryRiskFlags'] as string[] : [],
    retrievalVersion: getStringField(data, 'retrievalVersion'),
    matchedMemories: Array.isArray(data['matchedMemories'])
      ? data['matchedMemories'] as ExecutionMemoryApplication['matchedMemories']
      : [],
    status: data['status'] as ExecutionMemoryApplication['status'],
    memoryIdsUsed: Array.isArray(data['memoryIdsUsed']) ? data['memoryIdsUsed'] as string[] : [],
    memoryIdsRejected: Array.isArray(data['memoryIdsRejected']) ? data['memoryIdsRejected'] as string[] : [],
    ...(typeof data['evaluationSummary'] === 'string'
      ? { evaluationSummary: data['evaluationSummary'] }
      : {}),
    ...(perMemoryOutcome !== undefined ? { perMemoryOutcome } : {}),
    createdAt: data['createdAt'] as Timestamp,
    updatedAt: data['updatedAt'] as Timestamp,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

export interface FirestoreExecutionMemoryApplicationRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreExecutionMemoryApplicationRepository
implements ExecutionMemoryApplicationRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreExecutionMemoryApplicationRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async create(
    input: CreateExecutionMemoryApplicationInput
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>> {
    const id = `app_${randomUUID()}`;
    const now = Timestamp.fromDate(new Date());
    const docRef = this.firestore.collection('execution_memory_applications').doc(id);

    try {
      await docRef.set({
        ...input,
        createdAt: now,
        updatedAt: now,
      });

      return ok({
        id,
        ...input,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), id },
        'Failed to create execution memory application'
      );
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findById(
    id: string
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>> {
    try {
      const doc = await this.firestore.collection('execution_memory_applications').doc(id).get();

      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: `Execution memory application ${id} not found` });
      }

      return ok(toExecutionMemoryApplication(doc as { id: string; data(): Record<string, unknown> }));
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), id },
        'Failed to find execution memory application by id'
      );
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async update(
    id: string,
    input: UpdateExecutionMemoryApplicationInput
  ): Promise<Result<ExecutionMemoryApplication, ExecutionMemoryApplicationRepositoryError>> {
    try {
      const docRef = this.firestore.collection('execution_memory_applications').doc(id);
      const existing = await docRef.get();

      if (!existing.exists) {
        return err({ code: 'NOT_FOUND', message: `Execution memory application ${id} not found` });
      }

      const updateData: Record<string, unknown> = {
        updatedAt: Timestamp.fromDate(new Date()),
      };

      if (input.status !== undefined) updateData['status'] = input.status;
      if (input.memoryIdsUsed !== undefined) updateData['memoryIdsUsed'] = input.memoryIdsUsed;
      if (input.memoryIdsRejected !== undefined) {
        updateData['memoryIdsRejected'] = input.memoryIdsRejected;
      }
      if (input.evaluationSummary !== undefined) {
        updateData['evaluationSummary'] = input.evaluationSummary;
      }
      if (input.perMemoryOutcome !== undefined) {
        updateData['perMemoryOutcome'] = input.perMemoryOutcome;
      }
      if (input.completedAt !== undefined) {
        updateData['completedAt'] = Timestamp.fromDate(input.completedAt);
      }

      await docRef.update(updateData);
      const updated = await docRef.get();
      return ok(toExecutionMemoryApplication(updated as { id: string; data(): Record<string, unknown> }));
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), id, input },
        'Failed to update execution memory application'
      );
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreExecutionMemoryApplicationRepository(
  deps: FirestoreExecutionMemoryApplicationRepositoryDeps
): ExecutionMemoryApplicationRepository {
  return new FirestoreExecutionMemoryApplicationRepository(deps);
}

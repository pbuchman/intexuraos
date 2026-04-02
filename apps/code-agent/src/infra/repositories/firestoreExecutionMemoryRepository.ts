import { randomUUID } from 'node:crypto';
import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { FieldValue, Timestamp, type Firestore } from '@intexuraos/infra-firestore';

import type { ExecutionMemory, ExecutionMemoryMatch } from '../../domain/models/executionMemory.js';
import type {
  CreateExecutionMemoryInput,
  ExecutionMemoryRepository,
  ExecutionMemoryRepositoryError,
  FindNearestExecutionMemoryInput,
  UpdateExecutionMemoryInput,
} from '../../domain/repositories/executionMemoryRepository.js';

function getStringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function toExecutionMemory(doc: { id: string; data(): Record<string, unknown> }): ExecutionMemory {
  const data = doc.data();
  return {
    id: doc.id,
    repository: getStringField(data, 'repository'),
    sourceTaskId: getStringField(data, 'sourceTaskId'),
    ...(typeof data['sourceLinearIssueId'] === 'string'
      ? { sourceLinearIssueId: data['sourceLinearIssueId'] }
      : {}),
    memoryType: data['memoryType'] as ExecutionMemory['memoryType'],
    title: getStringField(data, 'title'),
    appliesWhen: getStringField(data, 'appliesWhen'),
    action: getStringField(data, 'action'),
    avoid: getStringField(data, 'avoid'),
    verification: getStringField(data, 'verification'),
    evidenceSummary: getStringField(data, 'evidenceSummary'),
    retrievalText: getStringField(data, 'retrievalText'),
    keywords: Array.isArray(data['keywords']) ? data['keywords'] as string[] : [],
    labelHints: Array.isArray(data['labelHints']) ? data['labelHints'] as string[] : [],
    componentHints: Array.isArray(data['componentHints']) ? data['componentHints'] as string[] : [],
    embeddingModel: data['embeddingModel'] as ExecutionMemory['embeddingModel'],
    fingerprint: getStringField(data, 'fingerprint'),
    distillationVersion: getStringField(data, 'distillationVersion'),
    qualityScore: Number(data['qualityScore'] ?? 0),
    distillationConfidence: Number(data['distillationConfidence'] ?? data['qualityScore'] ?? 0),
    applicationCount: Number(data['applicationCount'] ?? 0),
    positiveCount: Number(data['positiveCount'] ?? 0),
    negativeCount: Number(data['negativeCount'] ?? 0),
    status: data['status'] as ExecutionMemory['status'],
    /* v8 ignore start -- test-infra: FakeFirestore cannot preserve Timestamp class identity through set/get roundtrips @preserve */
    ...(data['lastAppliedAt'] instanceof Timestamp ? { lastAppliedAt: data['lastAppliedAt'] } : {}),
    /* v8 ignore stop @preserve */
    createdAt: data['createdAt'] as Timestamp,
    updatedAt: data['updatedAt'] as Timestamp,
  };
}

export interface FirestoreExecutionMemoryRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreExecutionMemoryRepository implements ExecutionMemoryRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreExecutionMemoryRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async create(
    input: CreateExecutionMemoryInput
  ): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>> {
    const id = `mem_${randomUUID()}`;
    const now = Timestamp.fromDate(new Date());
    const docRef = this.firestore.collection('execution_memories').doc(id);

    try {
      await docRef.set({
        ...input,
        embedding: FieldValue.vector(input.embedding),
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
      this.logger.error({ error: getErrorMessage(error), id }, 'Failed to create execution memory');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findById(id: string): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>> {
    try {
      const doc = await this.firestore.collection('execution_memories').doc(id).get();

      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: `Execution memory ${id} not found` });
      }

      return ok(toExecutionMemory(doc as { id: string; data(): Record<string, unknown> }));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), id }, 'Failed to find execution memory by id');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findByFingerprint(
    repository: string,
    fingerprint: string
  ): Promise<Result<ExecutionMemory | null, ExecutionMemoryRepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection('execution_memories')
        .where('repository', '==', repository)
        .where('fingerprint', '==', fingerprint)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return ok(null);
      }

      const doc = snapshot.docs[0];
      if (doc === undefined) {
        return ok(null);
      }

      return ok(toExecutionMemory(doc as { id: string; data(): Record<string, unknown> }));
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), repository, fingerprint },
        'Failed to find execution memory by fingerprint'
      );
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async findNearest(
    input: FindNearestExecutionMemoryInput
  ): Promise<Result<ExecutionMemoryMatch[], ExecutionMemoryRepositoryError>> {
    try {
      const filteredCollection = this.firestore
        .collection('execution_memories')
        .where('repository', '==', input.repository)
        .where('status', '==', input.status ?? 'active');

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const vectorQuery = filteredCollection.findNearest(
        'embedding',
        FieldValue.vector(input.embedding),
        {
          limit: input.limit,
          distanceMeasure: 'COSINE',
        }
      );

      const snapshot = await vectorQuery.get();
      if (snapshot.empty) {
        return ok([]);
      }

      const matches = snapshot.docs.map((doc) => {
        const memory = toExecutionMemory(doc as { id: string; data(): Record<string, unknown> });
        const distance = (doc as { distance?: number }).distance ?? 0;
        return {
          ...memory,
          vectorScore: 1 - distance,
        };
      });

      return ok(matches);
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), input }, 'Failed to find nearest execution memories');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async update(
    id: string,
    input: UpdateExecutionMemoryInput
  ): Promise<Result<ExecutionMemory, ExecutionMemoryRepositoryError>> {
    try {
      const docRef = this.firestore.collection('execution_memories').doc(id);
      const existing = await docRef.get();

      if (!existing.exists) {
        return err({ code: 'NOT_FOUND', message: `Execution memory ${id} not found` });
      }

      const updateData: Record<string, unknown> = {
        updatedAt: Timestamp.fromDate(new Date()),
      };

      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        updateData[key] = key === 'embedding' ? FieldValue.vector(value as number[]) : value;
      }

      await docRef.update(updateData);
      const updated = await docRef.get();
      return ok(toExecutionMemory(updated as { id: string; data(): Record<string, unknown> }));
    } catch (error) {
      this.logger.error({ error: getErrorMessage(error), id, input }, 'Failed to update execution memory');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreExecutionMemoryRepository(
  deps: FirestoreExecutionMemoryRepositoryDeps
): ExecutionMemoryRepository {
  return new FirestoreExecutionMemoryRepository(deps);
}

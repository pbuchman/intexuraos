/**
 * Firestore composite indexes tests for code_tasks collection.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 2121-2178)
 *
 * Note: These tests verify that the indexes are defined correctly in firestore.indexes.json.
 * Full verification of query performance happens in production Firestore or with emulator.
 *
 * To deploy indexes:
 * firebase deploy --only firestore:indexes --project=intexuraos
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From apps/code-agent/src/__tests__/firestore-rules/ go up 5 levels to monorepo root
const INDEXES_FILE = join(__dirname, '..', '..', '..', '..', '..', 'firestore.indexes.json');

interface IndexDef {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string; order: 'ASCENDING' | 'DESCENDING' }[];
}

// Load indexes at module level so all describe blocks can access it
const indexesContent = readFileSync(INDEXES_FILE, 'utf8');
const indexesJson = JSON.parse(indexesContent) as { indexes: IndexDef[] };

describe('code_tasks Firestore composite indexes', () => {
  describe('indexes file', () => {
    it('should exist and be readable', () => {
      expect(existsSync(INDEXES_FILE)).toBe(true);
    });

    it('should contain valid JSON', () => {
      expect(indexesJson).toBeDefined();
      expect(Array.isArray(indexesJson.indexes)).toBe(true);
    });
  });

  describe('code_tasks indexes', () => {
    const codeTasksIndexes = indexesJson.indexes.filter(
      (idx) => idx.collectionGroup === 'code_tasks'
    );

    it('should have userId + status + createdAt index for task listing', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 3 &&
        idx.fields[0]?.fieldPath === 'userId' &&
        idx.fields[1]?.fieldPath === 'status' &&
        idx.fields[2]?.fieldPath === 'createdAt' &&
        idx.fields[2]?.order === 'DESCENDING'
      );
      expect(index).toBeDefined();
    });

    it('should have dedupKey + createdAt DESC index for deduplication', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'dedupKey' &&
        idx.fields[1]?.fieldPath === 'createdAt' &&
        idx.fields[1]?.order === 'DESCENDING'
      );
      expect(index).toBeDefined();
    });

    it('should have dedupKey + createdAt ASC index for reverse deduplication', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'dedupKey' &&
        idx.fields[1]?.fieldPath === 'createdAt' &&
        idx.fields[1]?.order === 'ASCENDING'
      );
      expect(index).toBeDefined();
    });

    it('should have userId + createdAt DESC index for user task listing', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'userId' &&
        idx.fields[1]?.fieldPath === 'createdAt' &&
        idx.fields[1]?.order === 'DESCENDING'
      );
      expect(index).toBeDefined();
    });

    it('should have status + updatedAt index for zombie detection', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'status' &&
        idx.fields[1]?.fieldPath === 'updatedAt' &&
        idx.fields[1]?.order === 'ASCENDING'
      );
      expect(index).toBeDefined();
    });

    it('should have linearIssueId + status index for single task per issue', () => {
      const index = codeTasksIndexes.find((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'linearIssueId' &&
        idx.fields[1]?.fieldPath === 'status'
      );
      expect(index).toBeDefined();
    });
  });

  describe('logs subcollection indexes', () => {
    const logsIndexes = indexesJson.indexes.filter(
      (idx) => idx.collectionGroup === 'logs'
    );

    it('should have sequence ASC index for log streaming', () => {
      const index = logsIndexes.find((idx) =>
        idx.fields.length === 1 &&
        idx.fields[0]?.fieldPath === 'sequence' &&
        idx.fields[0]?.order === 'ASCENDING'
      );
      expect(index).toBeDefined();
    });
  });

  describe('index query requirements', () => {
    const codeTasksIndexes = indexesJson.indexes.filter(
      (idx) => idx.collectionGroup === 'code_tasks'
    );

    it('should support GET /code/tasks with status filter', () => {
      // Query: where('userId', '==', uid).where('status', '==', status).orderBy('createdAt', 'desc')
      const hasIndex = codeTasksIndexes.some((idx) =>
        idx.fields.length === 3 &&
        idx.fields[0]?.fieldPath === 'userId' &&
        idx.fields[1]?.fieldPath === 'status' &&
        idx.fields[2]?.fieldPath === 'createdAt' &&
        idx.fields[2]?.order === 'DESCENDING'
      );
      expect(hasIndex).toBe(true);
    });

    it('should support deduplication check within time window', () => {
      // Query: where('dedupKey', '==', key).where('createdAt', '>', fiveMinutesAgo).orderBy('createdAt', 'desc')
      const hasIndex = codeTasksIndexes.some((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'dedupKey' &&
        idx.fields[1]?.fieldPath === 'createdAt' &&
        idx.fields[1]?.order === 'DESCENDING'
      );
      expect(hasIndex).toBe(true);
    });

    it('should support zombie task detection', () => {
      // Query: where('status', '==', 'running').where('updatedAt', '<', thirtyMinutesAgo)
      const hasIndex = codeTasksIndexes.some((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'status' &&
        idx.fields[1]?.fieldPath === 'updatedAt' &&
        idx.fields[1]?.order === 'ASCENDING'
      );
      expect(hasIndex).toBe(true);
    });

    it('should support single task per Linear issue check', () => {
      // Query: where('linearIssueId', '==', id).where('status', 'in', ['dispatched', 'running'])
      const hasIndex = codeTasksIndexes.some((idx) =>
        idx.fields.length === 2 &&
        idx.fields[0]?.fieldPath === 'linearIssueId' &&
        idx.fields[1]?.fieldPath === 'status'
      );
      expect(hasIndex).toBe(true);
    });

    it('should support log streaming in order', () => {
      // Query: collection('code_tasks').doc(taskId).collection('logs').orderBy('sequence', 'asc')
      const logsIndexes = indexesJson.indexes.filter(
        (idx) => idx.collectionGroup === 'logs'
      );
      const hasIndex = logsIndexes.some((idx) =>
        idx.fields.length === 1 &&
        idx.fields[0]?.fieldPath === 'sequence' &&
        idx.fields[0]?.order === 'ASCENDING'
      );
      expect(hasIndex).toBe(true);
    });
  });
});

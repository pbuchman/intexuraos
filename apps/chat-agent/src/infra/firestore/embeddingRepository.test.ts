/**
 * Tests for FirestoreEmbeddingRepository.
 * Note: These tests use in-memory Firestore fake when available.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FirestoreEmbeddingRepository } from './embeddingRepository.js';
import { setFirestore, resetFirestore, type Firestore } from '@intexuraos/infra-firestore';

interface MockDocData {
  content?: unknown;
  filePath?: unknown;
  section?: unknown;
  docType?: unknown;
  createdAt?: unknown;
}

interface MockDoc {
  id: string;
  data: () => MockDocData;
  distance?: number;
}

function createMockFirestore(options: {
  docs?: MockDoc[];
  throwOnGet?: boolean;
  findByIdDoc?: MockDoc | null;
  findByIdExistsButNoData?: boolean;
}): Firestore {
  const docs = options.docs ?? [];
  return {
    collection: (): unknown => ({
      doc: (id?: string): unknown => ({
        get: (): Promise<{ exists: boolean; data: () => MockDocData | undefined; id: string }> => {
          if (options.findByIdExistsButNoData === true) {
            return Promise.resolve({
              exists: true,
              data: () => undefined,
              id: id ?? 'unknown',
            });
          }
          if (options.findByIdDoc !== undefined) {
            if (options.findByIdDoc === null) {
              return Promise.resolve({
                exists: false,
                data: () => undefined,
                id: id ?? 'unknown',
              });
            }
            return Promise.resolve({
              exists: true,
              data: () => options.findByIdDoc?.data() ?? {},
              id: options.findByIdDoc.id,
            });
          }
          return Promise.resolve({
            exists: false,
            data: () => undefined,
            id: id ?? 'unknown',
          });
        },
      }),
      findNearest: (): unknown => ({
        get: (): Promise<{ empty: boolean; docs: MockDoc[] }> => {
          if (options.throwOnGet === true) {
            return Promise.reject(new Error('Firestore connection failed'));
          }
          return Promise.resolve({
            empty: docs.length === 0,
            docs,
          });
        },
      }),
    }),
  } as unknown as Firestore;
}

describe('FirestoreEmbeddingRepository', () => {
  let repository: FirestoreEmbeddingRepository;

  afterEach((): void => {
    resetFirestore();
  });

  describe('findNearest', () => {
    describe('handles empty collection', () => {
      beforeEach((): void => {
        setFirestore(createMockFirestore({ docs: [] }));
        repository = new FirestoreEmbeddingRepository();
      });

      it('should return empty array when no documents exist', async () => {
        const queryVector = new Array(1536).fill(0.1);
        const result = await repository.findNearest(queryVector, 5);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual([]);
        }
      });
    });

    describe('returns documents with proper transformation', () => {
      beforeEach((): void => {
        const mockDocs: MockDoc[] = [
          {
            id: 'doc-1',
            distance: 0.2,
            data: () => ({
              content: 'Test content',
              filePath: '/docs/test.md',
              section: 'Introduction',
              docType: 'markdown',
              createdAt: { seconds: 1704067200, nanoseconds: 0 },
            }),
          },
          {
            id: 'doc-2',
            distance: 0.4,
            data: () => ({
              content: 'API spec content',
              filePath: '/api/spec.yaml',
              section: 'Endpoints',
              docType: 'openapi',
              createdAt: { seconds: 1704153600, nanoseconds: 0 },
            }),
          },
        ];
        setFirestore(createMockFirestore({ docs: mockDocs }));
        repository = new FirestoreEmbeddingRepository();
      });

      it('should transform documents to DocChunkWithScore', async () => {
        const queryVector = new Array(1536).fill(0.1);
        const result = await repository.findNearest(queryVector, 5);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(2);
          expect(result.value[0]).toEqual({
            id: 'doc-1',
            content: 'Test content',
            filePath: '/docs/test.md',
            section: 'Introduction',
            docType: 'markdown',
            createdAt: { seconds: 1704067200, nanoseconds: 0 },
            score: 0.8,
          });
          expect(result.value[1]).toEqual({
            id: 'doc-2',
            content: 'API spec content',
            filePath: '/api/spec.yaml',
            section: 'Endpoints',
            docType: 'openapi',
            createdAt: { seconds: 1704153600, nanoseconds: 0 },
            score: 0.6,
          });
        }
      });
    });

    describe('filters by docType', () => {
      beforeEach((): void => {
        const mockDocs: MockDoc[] = [
          {
            id: 'doc-1',
            distance: 0.2,
            data: () => ({
              content: 'Markdown content',
              filePath: '/docs/guide.md',
              section: 'Guide',
              docType: 'markdown',
              createdAt: { seconds: 1704067200, nanoseconds: 0 },
            }),
          },
          {
            id: 'doc-2',
            distance: 0.3,
            data: () => ({
              content: 'OpenAPI content',
              filePath: '/api/spec.yaml',
              section: 'API',
              docType: 'openapi',
              createdAt: { seconds: 1704153600, nanoseconds: 0 },
            }),
          },
        ];
        setFirestore(createMockFirestore({ docs: mockDocs }));
        repository = new FirestoreEmbeddingRepository();
      });

      it('should filter results by docType when specified', async () => {
        const queryVector = new Array(1536).fill(0.1);
        const result = await repository.findNearest(queryVector, 5, { docType: 'markdown' });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(1);
          expect(result.value[0]?.id).toBe('doc-1');
          expect(result.value[0]?.docType).toBe('markdown');
        }
      });
    });

    describe('handles missing or invalid field values', () => {
      beforeEach((): void => {
        const mockDocs: MockDoc[] = [
          {
            id: 'doc-missing-fields',
            distance: 0.1,
            data: () => ({
              content: undefined,
              filePath: null,
              section: 123,
              docType: 'invalid-type',
              createdAt: undefined,
            }),
          },
          {
            id: 'doc-no-distance',
            data: () => ({
              content: 'Valid content',
              filePath: '/path/file.md',
              section: 'Section',
              docType: 'markdown',
              createdAt: { seconds: 1000, nanoseconds: 0 },
            }),
          },
        ];
        setFirestore(createMockFirestore({ docs: mockDocs }));
        repository = new FirestoreEmbeddingRepository();
      });

      it('should use default values for missing or invalid fields', async () => {
        const queryVector = new Array(1536).fill(0.1);
        const result = await repository.findNearest(queryVector, 5);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(2);

          const firstDoc = result.value[0];
          expect(firstDoc?.id).toBe('doc-missing-fields');
          expect(firstDoc?.content).toBe('');
          expect(firstDoc?.filePath).toBe('');
          expect(firstDoc?.section).toBe('');
          expect(firstDoc?.docType).toBe('markdown');
          expect(firstDoc?.createdAt).toEqual({ seconds: 0, nanoseconds: 0 });
          expect(firstDoc?.score).toBe(0.9);

          const secondDoc = result.value[1];
          expect(secondDoc?.id).toBe('doc-no-distance');
          expect(secondDoc?.score).toBe(1);
        }
      });
    });

    describe('handles errors', () => {
      beforeEach((): void => {
        setFirestore(createMockFirestore({ throwOnGet: true }));
        repository = new FirestoreEmbeddingRepository();
      });

      it('should return error on Firestore failure', async () => {
        const queryVector = new Array(1536).fill(0.1);
        const result = await repository.findNearest(queryVector, 5);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('QUERY_ERROR');
          expect(result.error.message).toContain('Firestore query failed');
        }
      });
    });
  });

  describe('findById', () => {
    it('should return null for non-existent document', async () => {
      setFirestore(createMockFirestore({ findByIdDoc: null }));
      repository = new FirestoreEmbeddingRepository();

      const result = await repository.findById('non-existent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return null when document exists but data is undefined', async () => {
      setFirestore(createMockFirestore({ findByIdExistsButNoData: true }));
      repository = new FirestoreEmbeddingRepository();

      const result = await repository.findById('doc-with-no-data');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('should return document chunk when found', async () => {
      setFirestore(createMockFirestore({
        findByIdDoc: {
          id: 'doc-123',
          data: () => ({
            content: 'Found content',
            filePath: '/path/to/file.md',
            section: 'Found Section',
            docType: 'markdown',
            createdAt: { seconds: 1704067200, nanoseconds: 0 },
          }),
        },
      }));
      repository = new FirestoreEmbeddingRepository();

      const result = await repository.findById('doc-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.id).toBe('doc-123');
        expect(result.value?.content).toBe('Found content');
        expect(result.value?.filePath).toBe('/path/to/file.md');
        expect(result.value?.section).toBe('Found Section');
        expect(result.value?.docType).toBe('markdown');
        expect(result.value?.embedding).toEqual([]);
      }
    });

    it('should handle missing or invalid field values', async () => {
      setFirestore(createMockFirestore({
        findByIdDoc: {
          id: 'doc-bad-data',
          data: () => ({
            content: null,
            filePath: undefined,
            section: 42,
            docType: 'unknown',
            createdAt: null,
          }),
        },
      }));
      repository = new FirestoreEmbeddingRepository();

      const result = await repository.findById('doc-bad-data');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.content).toBe('');
        expect(result.value?.filePath).toBe('');
        expect(result.value?.section).toBe('');
        expect(result.value?.docType).toBe('markdown');
        expect(result.value?.createdAt).toEqual({ seconds: 0, nanoseconds: 0 });
      }
    });
  });

  describe('findSimilar', () => {
    beforeEach((): void => {
      const mockDocs: MockDoc[] = [
        {
          id: 'similar-1',
          distance: 0.15,
          data: () => ({
            content: 'Similar content',
            filePath: '/docs/similar.md',
            section: 'Similar',
            docType: 'markdown',
            createdAt: { seconds: 1704067200, nanoseconds: 0 },
          }),
        },
      ];
      setFirestore(createMockFirestore({ docs: mockDocs }));
      repository = new FirestoreEmbeddingRepository();
    });

    it('should delegate to findNearest', async () => {
      const queryVector = new Array(1536).fill(0.1);
      const result = await repository.findSimilar(queryVector, 3);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.id).toBe('similar-1');
        expect(result.value[0]?.score).toBe(0.85);
      }
    });
  });
});

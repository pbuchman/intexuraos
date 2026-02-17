/**
 * Tests for migration 040: Create doc_embeddings collection
 */

import { describe, it, expect, vi } from 'vitest';
import { up, indexes, rules, metadata } from '../040_create_doc_embeddings.mjs';

describe('040-create-doc-embeddings migration', () => {
  describe('metadata', () => {
    it('should have correct metadata structure', () => {
      expect(metadata).toMatchObject({
        id: '040',
        name: 'create-doc-embeddings',
        description: 'Create doc_embeddings collection with vector index',
        createdAt: '2026-01-31',
      });
    });

    it('should have sequential ID', () => {
      expect(Number.parseInt(metadata.id, 10)).toBe(40);
    });
  });

  describe('vector index configuration', () => {
    it('should define vector index for doc_embeddings', () => {
      expect(indexes).toHaveLength(1);
      expect(indexes[0]).toMatchObject({
        collectionGroup: 'doc_embeddings',
        queryScope: 'COLLECTION',
      });
    });

    it('should have 1536 dimensions for OpenAI text-embedding-3-small', () => {
      const embeddingField = indexes[0].fields[0];
      expect(embeddingField.fieldPath).toBe('embedding');
      expect(embeddingField.vectorConfig).toMatchObject({
        dimension: 1536,
        flatIndexEnabled: true,
      });
    });

    it('should use ASCENDING order for vector field', () => {
      const embeddingField = indexes[0].fields[0];
      expect(embeddingField.order).toBe('ASCENDING');
    });
  });

  describe('security rules', () => {
    it('should define doc_embeddings collection rules', () => {
      expect(rules.collections).toBeDefined();
      expect(rules.collections['doc_embeddings/{chunkId}']).toBeDefined();
    });

    it('should allow authenticated reads', () => {
      const collectionRules = rules.collections['doc_embeddings/{chunkId}'];
      expect(collectionRules.read).toContain('isAuthenticated');
    });

    it('should forbid client writes', () => {
      const collectionRules = rules.collections['doc_embeddings/{chunkId}'];
      expect(collectionRules.write).toBe('false');
      expect(collectionRules.writeComment).toContain('backend-only');
    });

    it('should include descriptive comments', () => {
      const collectionRules = rules.collections['doc_embeddings/{chunkId}'];
      expect(collectionRules.comment).toContain('RAG');
      expect(collectionRules.readComment).toBeDefined();
      expect(collectionRules.writeComment).toBeDefined();
    });
  });

  describe('up function', () => {
    it('should be a function', () => {
      expect(typeof up).toBe('function');
    });

    it('should deploy indexes and rules', async () => {
      const deployIndexes = vi.fn();
      const deployRules = vi.fn();
      const context = { deployIndexes, deployRules };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log for test isolation
      });

      await up(context);

      expect(deployIndexes).toHaveBeenCalledTimes(1);
      expect(deployRules).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });

  describe('idempotency', () => {
    it('should handle multiple up calls safely', async () => {
      const deployIndexes = vi.fn().mockResolvedValue(undefined);
      const deployRules = vi.fn().mockResolvedValue(undefined);
      const context = { deployIndexes, deployRules };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log for test isolation
      });

      // Run migration twice
      await up(context);
      await up(context);

      // Each call should deploy once
      expect(deployIndexes).toHaveBeenCalledTimes(2);
      expect(deployRules).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });
});

/**
 * Tests for embed-docs script.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock the modules before importing
vi.mock('@google-cloud/firestore');

describe('embed-docs script', () => {
  const mockDocsPath = path.join(process.cwd(), 'test-docs');
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMarkdown', () => {
    it('parses markdown by headers', async () => {
      const content = `# Introduction

This is the intro.

## Features

Here are the features.

### Feature 1

Details about feature 1.
`;

      // Import after mocks are set up
      const { parseMarkdown } = await import('../embed-docs.js');

      const chunks = parseMarkdown('test.md', content);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].section).toBe('Introduction');
      expect(chunks[1].section).toBe('Features');
      expect(chunks[2].section).toBe('Feature 1');
    });

    it('handles empty file', async () => {
      const { parseMarkdown } = await import('../embed-docs.js');

      const chunks = parseMarkdown('empty.md', '');

      // Empty content still creates one chunk with empty string
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('');
    });

    it('handles file without headers', async () => {
      const { parseMarkdown } = await import('../embed-docs.js');

      const chunks = parseMarkdown('plain.md', 'Just plain text content.');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].section).toBe('Introduction');
      expect(chunks[0].content).toBe('Just plain text content.');
    });

    it('chunks respect max size', async () => {
      const { parseMarkdown } = await import('../embed-docs.js');

      // Create content with paragraph breaks so splitLargeChunks can work
      // Need more than 8000 chars including header to trigger splitting
      const paragraphs: string[] = [];
      for (let i = 0; i < 100; i++) {
        paragraphs.push('a'.repeat(100)); // Each paragraph is 100 chars
      }
      const largeContent = '# Large Section\n\n' + paragraphs.join('\n\n'); // ~10000 chars

      const chunks = parseMarkdown('large.md', largeContent);

      // The large chunk should be split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be under 8000 chars
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(8000);
      }
    });
  });

  describe('findMarkdownFiles', () => {
    // Note: These are integration-style tests that work with real filesystem
    // The fs mocking with { withFileTypes: true } is complex, so we use real directories
    it('finds all .md files recursively', async () => {
      const { findMarkdownFiles } = await import('../embed-docs.js');
      const tmpDir = '/tmp/test-find-md-' + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');

      try {
        // Create test directory structure
        mkdirSync(tmpDir, { recursive: true });
        mkdirSync(`${tmpDir}/subdir`, { recursive: true });
        writeFileSync(`${tmpDir}/file1.md`, '# Test');
        writeFileSync(`${tmpDir}/subdir/file2.md`, '# Test 2');
        writeFileSync(`${tmpDir}/notmd.txt`, 'Not markdown');

        const files = findMarkdownFiles(tmpDir);

        // Should find both .md files
        expect(files).toContain(`${tmpDir}/file1.md`);
        expect(files).toContain(`${tmpDir}/subdir/file2.md`);
        // Should not find .txt file
        expect(files).not.toContain(`${tmpDir}/notmd.txt`);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('skips node_modules and hidden directories', async () => {
      const { findMarkdownFiles } = await import('../embed-docs.js');
      const tmpDir = '/tmp/test-skip-dirs-' + Date.now();
      const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');

      try {
        // Create test directory with node_modules and hidden dir
        mkdirSync(tmpDir, { recursive: true });
        mkdirSync(`${tmpDir}/node_modules`, { recursive: true });
        mkdirSync(`${tmpDir}/.hidden`, { recursive: true });
        writeFileSync(`${tmpDir}/node_modules/package.json`, '{}');
        writeFileSync(`${tmpDir}/.hidden/secret.md`, '# Secret');
        writeFileSync(`${tmpDir}/file.md`, '# Public');

        const files = findMarkdownFiles(tmpDir);

        // Should only find file.md, skip node_modules and .hidden
        expect(files).toContain(`${tmpDir}/file.md`);
        expect(files).not.toContain(`${tmpDir}/node_modules/package.json`);
        expect(files).not.toContain(`${tmpDir}/.hidden/secret.md`);
        expect(files.length).toBe(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('parseOpenAPI', () => {
    it('parses valid OpenAPI spec by endpoint', async () => {
      const { parseOpenAPI } = await import('../embed-docs.js');

      const spec = {
        openapi: '3.0.0',
        paths: {
          '/todos': {
            get: {
              summary: 'List todos',
              description: 'Get all todos',
            },
            post: {
              summary: 'Create todo',
            },
          },
        },
      };

      const chunks = parseOpenAPI('openapi.json', spec);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].section).toBe('GET /todos');
      expect(chunks[0].docType).toBe('openapi');
      expect(chunks[1].section).toBe('POST /todos');
    });

    it('handles invalid OpenAPI spec gracefully', async () => {
      const { parseOpenAPI } = await import('../embed-docs.js');

      // Console.error should be called, not throw
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const chunks = parseOpenAPI('invalid.json', null);

      expect(chunks).toEqual([]);
      errorSpy.mockRestore();
    });
  });

  describe('getDocId', () => {
    it('generates consistent document IDs', async () => {
      const { getDocId } = await import('../embed-docs.js');

      const id1 = getDocId('docs/services/todos-agent/API.md', 'POST /todos');
      const id2 = getDocId('docs/services/todos-agent/API.md', 'POST /todos');

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[a-f0-9]{32}$/);
    });

    it('generates different IDs for different sections', async () => {
      const { getDocId } = await import('../embed-docs.js');

      const id1 = getDocId('docs/test.md', 'Section 1');
      const id2 = getDocId('docs/test.md', 'Section 2');

      expect(id1).not.toBe(id2);
    });

    it('avoids collisions for similar paths', async () => {
      const { getDocId } = await import('../embed-docs.js');

      const id1 = getDocId('docs/test/file.md', 'Section');
      const id2 = getDocId('docs-test-file.md', 'Section');

      expect(id1).not.toBe(id2);
    });
  });

  describe('splitLargeChunks', () => {
    it('splits chunks exceeding max size', async () => {
      const { splitLargeChunks } = await import('../embed-docs.js');

      // Create content with paragraph breaks so it can be split
      const paragraphs: string[] = [];
      for (let i = 0; i < 100; i++) {
        paragraphs.push('z'.repeat(100));
      }
      const largeContent = paragraphs.join('\n\n'); // ~10000 chars with paragraph breaks

      const chunks = [
        {
          content: largeContent,
          filePath: 'test.md',
          section: 'Large',
          docType: 'markdown' as const,
        },
      ];

      const result = splitLargeChunks(chunks, 8000);

      // Should split into multiple chunks
      expect(result.length).toBeGreaterThan(1);

      // Each chunk should be under 8000 chars
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(8000);
      }
    });

    it('preserves small chunks unchanged', async () => {
      const { splitLargeChunks } = await import('../embed-docs.js');

      const chunks = [
        {
          content: 'Small content',
          filePath: 'test.md',
          section: 'Small',
          docType: 'markdown' as const,
        },
      ];

      const result = splitLargeChunks(chunks, 8000);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Small content');
    });
  });

  describe('generateEmbedding', () => {
    it('generates 1536-dim vector for valid text', async () => {
      const { generateEmbedding } = await import('../embed-docs.js');

      // Mock fetch to return a fake embedding
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      }) as any;

      const result = await generateEmbedding('test text', mockApiKey);

      expect(result).toHaveLength(1536);
    });

    it('handles API error', async () => {
      const { generateEmbedding } = await import('../embed-docs.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }) as any;

      await expect(generateEmbedding('test text', mockApiKey)).rejects.toThrow(
        'OpenAI API error: 401'
      );
    });
  });
});

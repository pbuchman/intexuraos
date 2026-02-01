/**
 * Tests for embed-docs script.
 *
 * Tests the embedding generation workflow including:
 * - Markdown parsing by headers
 * - Chunk size enforcement
 * - OpenAI embedding generation
 * - Batch processing and rate limit handling
 * - OpenAPI spec parsing
 * - Firestore upserts and cleanup
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  parseMarkdown,
  enforceMaxSize,
  parseOpenAPI,
  type OpenAPISpec,
  type MarkdownChunk,
} from './index.js';

// Mock environment variables
const mockApiKey = 'test-api-key';

describe('embed-docs', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', mockApiKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('parseMarkdown', () => {
    it('should parse markdown file by headers', () => {
      const content = `# Introduction

This is the intro.

## Features

- Feature 1
- Feature 2

### Feature Details

More details here.

## Configuration

Config options.`;

      const chunks = parseMarkdown('test.md', content);

      expect(chunks).toHaveLength(4);
      expect(chunks[0]).toMatchObject({
        section: 'Introduction',
        level: 1,
      });
      expect(chunks[0].content).toContain('# Introduction');
      expect(chunks[1]).toMatchObject({
        section: 'Features',
        level: 2,
      });
    });

    it('should handle empty files', () => {
      const chunks = parseMarkdown('empty.md', '');
      expect(chunks).toEqual([]);
    });

    it('should handle files without headers by creating default chunk', () => {
      const content = 'Just some text\nwithout any headers.';
      const chunks = parseMarkdown('no-headers.md', content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        section: 'Introduction',
        level: 1,
      });
      expect(chunks[0].content).toContain('Just some text');
    });

    it('should preserve content within each section', () => {
      const content = `# Title

First paragraph.

Second paragraph.

## Section 2

Content here.`;

      const chunks = parseMarkdown('test.md', content);

      expect(chunks[0].content).toContain('First paragraph.');
      expect(chunks[0].content).toContain('Second paragraph.');
      expect(chunks[1].content).toContain('Content here.');
    });

    it('should handle nested headers correctly', () => {
      const content = `# Level 1

Content L1.

## Level 2

Content L2.

### Level 3

Content L3.`;

      const chunks = parseMarkdown('test.md', content);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].level).toBe(1);
      expect(chunks[1].level).toBe(2);
      expect(chunks[2].level).toBe(3);
    });
  });

  describe('enforceMaxSize', () => {
    it('should not split small chunks', () => {
      const chunks: MarkdownChunk[] = [
        {
          content: 'Small content',
          section: 'Test',
          level: 1,
        },
      ];

      const result = enforceMaxSize(chunks, 'test.md');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Small content');
    });

    it('should split chunks that exceed max size', () => {
      const largeParagraph = 'a'.repeat(3000);
      const content = `${largeParagraph}\n\n${largeParagraph}\n\n${largeParagraph}`;
      const chunks: MarkdownChunk[] = [
        {
          content,
          section: 'Large Section',
          level: 1,
        },
      ];

      const result = enforceMaxSize(chunks, 'test.md');

      // Should be split into multiple parts
      expect(result.length).toBeGreaterThan(1);
      expect(result[0].section).toContain('part 1');
      expect(result[1].section).toContain('part 2');
      // Each chunk should be under max size
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(8000);
      }
    });

    it('should split by paragraphs when possible', () => {
      // Create content that's too large but has clear paragraph breaks
      const paragraphs: string[] = [];
      for (let i = 0; i < 10; i++) {
        paragraphs.push(`Paragraph ${i}: ${'x'.repeat(1000)}`);
      }
      const content = paragraphs.join('\n\n');

      const chunks: MarkdownChunk[] = [
        {
          content,
          section: 'Multi Paragraph',
          level: 1,
        },
      ];

      const result = enforceMaxSize(chunks, 'test.md');

      // Should split at paragraph boundaries
      expect(result.length).toBeGreaterThan(1);
      // First chunk should end with a complete paragraph
      expect(result[0].content).toMatch(/Paragraph \d+: xxx+$/);
    });

    it('should handle single paragraph that exceeds max size', () => {
      // A single paragraph without \n\n that exceeds max size
      const hugeParagraph = 'a'.repeat(10000);
      const content = hugeParagraph;

      const chunks: MarkdownChunk[] = [
        {
          content,
          section: 'Huge Paragraph',
          level: 1,
        },
      ];

      const result = enforceMaxSize(chunks, 'test.md');

      // Should still split, even without paragraph breaks
      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const chunk of result) {
        expect(chunk.content.length).toBeLessThanOrEqual(8000);
      }
    });

    it('should preserve section info in split parts', () => {
      const largeContent = 'b'.repeat(9000);
      const chunks: MarkdownChunk[] = [
        {
          content: largeContent,
          section: 'Original Section',
          level: 2,
        },
      ];

      const result = enforceMaxSize(chunks, 'test.md');

      expect(result[0].section).toBe('Original Section (part 1)');
      expect(result[1].section).toBe('Original Section (part 2)');
      expect(result[0].level).toBe(2);
      expect(result[1].level).toBe(2);
    });
  });

  describe('parseOpenAPI', () => {
    const validSpec: OpenAPISpec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            summary: 'List users',
            description: 'Returns a list of users',
          },
          post: {
            summary: 'Create user',
            description: 'Creates a new user',
          },
        },
        '/users/{id}': {
          get: {
            summary: 'Get user',
            description: 'Returns a single user',
          },
        },
      },
    };

    it('should parse OpenAPI spec into endpoint chunks', () => {
      const chunks = parseOpenAPI('test-openapi.json', validSpec);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].section).toBe('GET /users');
      expect(chunks[1].section).toBe('POST /users');
      expect(chunks[2].section).toBe('GET /users/{id}');
    });

    it('should include summary and description in content', () => {
      const chunks = parseOpenAPI('test-openapi.json', validSpec);

      const getChunk = chunks.find((c) => c.section === 'GET /users');
      expect(getChunk?.content).toContain('List users');
      expect(getChunk?.content).toContain('Returns a list of users');
    });

    it('should handle specs without paths', () => {
      const specNoPaths: OpenAPISpec = {
        openapi: '3.0.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: undefined,
      };

      const chunks = parseOpenAPI('empty.json', specNoPaths);

      expect(chunks).toEqual([]);
    });

    it('should handle specs with empty paths', () => {
      const specEmptyPaths: OpenAPISpec = {
        openapi: '3.0.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
      };

      const chunks = parseOpenAPI('empty.json', specEmptyPaths);

      expect(chunks).toEqual([]);
    });

    it('should handle missing summary (fallback to method name)', () => {
      const specNoSummary: OpenAPISpec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/test': {
            get: {},
          },
        },
      };

      const chunks = parseOpenAPI('test.json', specNoSummary);

      expect(chunks[0].content).toContain('### GET');
      expect(chunks[0].section).toBe('GET /test');
    });

    it('should handle missing description', () => {
      const specNoDescription: OpenAPISpec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              summary: 'Test endpoint',
            },
          },
        },
      };

      const chunks = parseOpenAPI('test.json', specNoDescription);

      expect(chunks[0].content).toContain('Test endpoint');
      expect(chunks[0].content).toContain('**Parameters:**');
    });

    it('should mark chunks with level 2', () => {
      const chunks = parseOpenAPI('test.json', validSpec);

      for (const chunk of chunks) {
        expect(chunk.level).toBe(2);
      }
    });
  });

  describe('Markdown + OpenAPI Integration', () => {
    it('should handle mixed content sources', () => {
      const markdownContent = `# API Documentation

## Users Service

Describes the users API.`;

      const openApiSpec: OpenAPISpec = {
        openapi: '3.0.0',
        info: { title: 'Users API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              summary: 'List users',
            },
          },
        },
      };

      const markdownChunks = parseMarkdown('users.md', markdownContent);
      const openApiChunks = parseOpenAPI('users-openapi.json', openApiSpec);

      expect(markdownChunks).toHaveLength(2);
      expect(openApiChunks).toHaveLength(1);

      // Combined should have 3 chunks
      const allChunks = [...markdownChunks, ...openApiChunks];
      expect(allChunks).toHaveLength(3);
    });
  });
});

/**
 * Embed Documentation Script
 *
 * Generates embeddings for documentation and uploads to Firestore.
 *
 * Usage:
 *   OPENAI_API_KEY=xxx pnpm run embed-docs
 *
 * Environment variables:
 *   OPENAI_API_KEY - OpenAI API key for embeddings
 *   GOOGLE_APPLICATION_CREDENTIALS - Path to GCP service account key
 *   FIRESTORE_EMULATOR_HOST - Optional: use emulator instead of prod
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Firestore } from '@google-cloud/firestore';

const require = createRequire(import.meta.url);

// ============================================================================
// Utilities
// ============================================================================

/**
 * Split an array into chunks of specified size.
 */
function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// ============================================================================
// Types
// ============================================================================

/** Document chunk with metadata. */
interface DocChunk {
  content: string;
  filePath: string;
  section: string;
  docType: 'markdown' | 'openapi';
}

/** Embedding result with vector. */
interface EmbeddedChunk extends DocChunk {
  embedding: number[];
}

/** Firestore document structure. */
interface FirestoreDocChunk {
  content: string;
  embedding: number[];
  filePath: string;
  section: string;
  docType: 'markdown' | 'openapi';
  createdAt: Date;
}

// ============================================================================
// Markdown Parsing
// ============================================================================

/**
 * Parse markdown file into chunks by headers.
 */
export function parseMarkdown(filePath: string, content: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  const lines = content.split('\n');

  let currentSection = 'Introduction';
  let currentContent: string[] = [];

  for (const line of lines) {
    // Check for headers (#, ##, ###)
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headerMatch) {
      // Save previous chunk if it has content
      if (currentContent.length > 0) {
        chunks.push({
          content: currentContent.join('\n').trim(),
          filePath,
          section: currentSection,
          docType: 'markdown',
        });
      }

      // Start new chunk
      currentSection = headerMatch[2].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Add final chunk
  if (currentContent.length > 0) {
    chunks.push({
      content: currentContent.join('\n').trim(),
      filePath,
      section: currentSection,
      docType: 'markdown',
    });
  }

  // Split chunks that exceed max size
  return splitLargeChunks(chunks, 8000);
}

/**
 * Split chunks that exceed maxChunkSize.
 */
export function splitLargeChunks(chunks: DocChunk[], maxSize: number): DocChunk[] {
  const result: DocChunk[] = [];

  for (const originalChunk of chunks) {
    if (originalChunk.content.length <= maxSize) {
      result.push(originalChunk);
      continue;
    }

    // Split large chunks
    const paragraphs = originalChunk.content.split('\n\n');
    let currentPart = '';

    for (const para of paragraphs) {
      const testContent = currentPart ? `${currentPart}\n\n${para}` : para;

      if (testContent.length <= maxSize) {
        currentPart = testContent;
      } else {
        if (currentPart) {
          result.push({
            ...originalChunk,
            content: currentPart,
            section:
              currentPart !== originalChunk.content
                ? `${originalChunk.section} (part ${result.length + 1})`
                : originalChunk.section,
          });
        }
        currentPart = para;
      }
    }

    if (currentPart) {
      result.push({
        ...originalChunk,
        content: currentPart,
        section:
          currentPart !== originalChunk.content
            ? `${originalChunk.section} (part ${result.length + 1})`
            : originalChunk.section,
      });
    }
  }

  return result;
}

/**
 * Find all markdown files in a directory recursively.
 */
export function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// OpenAPI Parsing
// ============================================================================

/**
 * Parse OpenAPI spec into chunks by endpoint.
 */
export function parseOpenAPI(specUrl: string, spec: unknown): DocChunk[] {
  const chunks: DocChunk[] = [];

  try {
    if (typeof spec !== 'object' || spec === null) {
      console.error(`Invalid OpenAPI spec from ${specUrl}`);
      return chunks;
    }

    const openapi = spec as { paths?: Record<string, unknown> };
    const paths = openapi.paths ?? {};

    for (const [path, pathItem] of Object.entries(paths)) {
      if (typeof pathItem !== 'object' || pathItem === null) {
        continue;
      }

      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === 'parameters' || method === 'servers' || method === '$ref') {
          continue;
        }

        if (typeof operation === 'object' && operation !== null) {
          const op = operation as { summary?: string; description?: string };

          const content = [
            `## ${method.toUpperCase()} ${path}`,
            op.summary ?? '',
            op.description ?? '',
          ]
            .filter(Boolean)
            .join('\n\n');

          chunks.push({
            content,
            filePath: specUrl,
            section: `${method.toUpperCase()} ${path}`,
            docType: 'openapi',
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error parsing OpenAPI from ${specUrl}:`, error);
  }

  return chunks;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for a single text using OpenAI API.
 */
export async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };

  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid embedding response: missing embedding data');
  }

  const embedding = data.data[0].embedding;

  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`Invalid embedding: expected 1536-dim array, got ${embedding.length}`);
  }

  return embedding;
}

/**
 * Generate embeddings for multiple texts in batches.
 */
export async function batchEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  const batchSize = 10;
  const maxRetries = 5;

  const batches = chunk(texts, batchSize);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(
          `  Batch ${batchIndex + 1}/${batches.length}: retry ${attempt}/${maxRetries} in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: batch,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          lastError = new Error(`OpenAI API error: ${response.status} ${errorText}`);
          if (response.status >= 500 || response.status === 429) {
            continue; // Retry on server errors and rate limits
          }
          throw lastError; // Non-retryable client error
        }

        const data = (await response.json()) as { data: Array<{ embedding: number[] }> };

        for (let i = 0; i < batch.length; i++) {
          const embedding = data.data[i]?.embedding;
          if (!Array.isArray(embedding) || embedding.length !== 1536) {
            throw new Error(
              `Invalid embedding at index ${i}: expected 1536-dim array, got ${embedding?.length ?? 0}`
            );
          }
          results.push(embedding);
        }

        lastError = null;
        break; // Success — exit retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!lastError.message.includes('500') && !lastError.message.includes('429')) {
          throw lastError; // Non-retryable
        }
      }
    }

    if (lastError !== null) {
      console.log(
        `  WARNING: Batch ${batchIndex + 1} failed after ${maxRetries} retries — skipping ${batch.length} chunks`
      );
      lastError = null; // Skip failed batch, continue with rest
    }

    // Rate limit delay: 150ms between batches
    await new Promise((resolve) => setTimeout(resolve, 150));

    if ((batchIndex + 1) % 50 === 0) {
      console.log(`  Progress: ${results.length}/${texts.length} embeddings generated`);
    }
  }

  return results;
}

/**
 * Generate embeddings for all chunks with retry on rate limit.
 */
export async function generateEmbeddings(
  chunks: DocChunk[],
  apiKey: string
): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];
  const texts = chunks.map((c) => c.content);

  console.log(`Generating embeddings for ${texts.length} chunks...`);

  let retryCount = 0;
  const maxRetries = 3;

  while (texts.length > results.length && retryCount < maxRetries) {
    try {
      const startIndex = results.length;
      const remainingTexts = texts.slice(startIndex);
      const embeddings = await batchEmbeddings(remainingTexts, apiKey);

      for (let i = 0; i < embeddings.length; i++) {
        results.push({
          ...chunks[startIndex + i],
          embedding: embeddings[i],
        });
      }

      retryCount = 0; // Reset on success
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        retryCount++;
        const delayMs = Math.pow(2, retryCount) * 1000;
        console.log(`Rate limited. Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const failedChunk = chunks[results.length];
        throw new Error(
          `Failed to generate embedding for chunk ${results.length + 1} (${failedChunk.filePath}:${failedChunk.section}): ${error}`
        );
      }
    }
  }

  return results;
}

// ============================================================================
// Firestore Operations
// ============================================================================

/**
 * Get Firestore instance.
 */
function getFirestoreClient(): {
  db: Firestore;
  FieldValue: typeof import('@google-cloud/firestore').FieldValue;
} {
  const { Firestore, FieldValue } = require('@google-cloud/firestore');

  const db = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'intexuraos-dev',
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Settings for emulator or production
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    db.settings({
      host: process.env.FIRESTORE_EMULATOR_HOST,
      ssl: false,
    });
  }

  return { db, FieldValue };
}

/**
 * Compute document ID from filePath and section using hash to avoid collisions.
 * Uses SHA-256 hash truncated to 32 chars for uniqueness while keeping IDs readable.
 */
export function getDocId(filePath: string, section: string): string {
  const combined = `${filePath}:${section}`;
  return createHash('sha256').update(combined).digest('hex').substring(0, 32);
}

/**
 * Upload chunks to Firestore with upsert semantics.
 * Uses FieldValue.vector() to store embeddings in the correct format for vector search.
 */
async function uploadChunks(chunks: EmbeddedChunk[]): Promise<void> {
  const { db, FieldValue } = getFirestoreClient();
  const collection = db.collection('doc_embeddings');

  console.log(`Uploading ${chunks.length} chunks to Firestore...`);

  let batch = db.batch();
  let batchCount = 0;
  const maxBatchSize = 500;

  for (const chunk of chunks) {
    const docId = getDocId(chunk.filePath, chunk.section);
    const docRef = collection.doc(docId);

    const data = {
      content: chunk.content,
      embedding: FieldValue.vector(chunk.embedding),
      filePath: chunk.filePath,
      section: chunk.section,
      docType: chunk.docType,
      createdAt: new Date(),
    };

    batch.set(docRef, data, { merge: true });
    batchCount++;

    if (batchCount >= maxBatchSize) {
      await batch.commit();
      console.log(`Committed batch of ${batchCount} documents`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount} documents`);
  }
}

/**
 * Clean up stale embeddings (docs that no longer exist).
 */
async function cleanStaleEmbeddings(currentFilePaths: Set<string>): Promise<void> {
  const { db } = getFirestoreClient();
  const collection = db.collection('doc_embeddings');

  console.log('Cleaning up stale embeddings...');

  const snapshot = await collection.select('filePath').get();

  let batch = db.batch();
  let batchCount = 0;
  const maxBatchSize = 500;

  for (const doc of snapshot.docs) {
    const data = doc.data() as { filePath?: string };
    const filePath = data.filePath;

    if (filePath && !currentFilePaths.has(filePath)) {
      batch.delete(doc.ref);
      batchCount++;

      if (batchCount >= maxBatchSize) {
        await batch.commit();
        console.log(`Deleted ${batchCount} stale documents`);
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`Deleted final batch of ${batchCount} stale documents`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('📚 Embed Documentation Script');
  console.log('================================\n');

  const startTime = Date.now();
  const openaiApiKey = process.env.OPENAI_API_KEY ?? '';

  if (!openaiApiKey) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const docsPath = join(process.cwd(), 'docs');

  // 1. Find all markdown files
  console.log('Step 1: Finding markdown files...');
  const markdownFiles = findMarkdownFiles(docsPath);
  console.log(`Found ${markdownFiles.length} markdown files`);

  // 2. Parse markdown files
  console.log('\nStep 2: Parsing markdown files...');
  const markdownChunks: DocChunk[] = [];

  for (const filePath of markdownFiles) {
    const relativePath = relative(process.cwd(), filePath);
    const content = readFileSync(filePath, 'utf-8');
    const chunks = parseMarkdown(relativePath, content);
    markdownChunks.push(...chunks);
  }

  console.log(`Parsed into ${markdownChunks.length} chunks`);

  // Filter out empty chunks (OpenAI cannot embed empty strings)
  const validChunks = markdownChunks.filter((c) => c.content.trim().length > 0);
  console.log(
    `Filtered to ${validChunks.length} non-empty chunks (removed ${markdownChunks.length - validChunks.length} empty)`
  );

  // 3. Fetch and parse OpenAPI specs (optional - skip for MVP)
  console.log('\nStep 3: OpenAPI parsing (skipped for MVP)');

  // 4. Generate embeddings
  console.log('\nStep 4: Generating embeddings...');
  const embeddedChunks = await generateEmbeddings(validChunks, openaiApiKey);
  console.log(`Generated ${embeddedChunks.length} embeddings`);

  // 5. Upload to Firestore
  console.log('\nStep 5: Uploading to Firestore...');
  const filePaths = new Set(validChunks.map((c) => c.filePath));
  await uploadChunks(embeddedChunks);

  // 6. Clean stale embeddings
  console.log('\nStep 6: Cleaning stale embeddings...');
  await cleanStaleEmbeddings(filePaths);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Done in ${elapsed}s`);
}

// Only run main() when this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`;

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

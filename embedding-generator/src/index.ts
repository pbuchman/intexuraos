#!/usr/bin/env tsx
/**
 * Embed Documentation Generation Script
 *
 * Parses markdown files and OpenAPI specs, generates embeddings via OpenAI,
 * and uploads them to Firestore doc_embeddings collection.
 *
 * Usage:
 *   OPENAI_API_KEY=xxx pnpm --filter @intexuraos/embedding-generator generate
 *
 * Environment:
 *   OPENAI_API_KEY - OpenAI API key for embeddings
 *   INTEXURAOS_GCP_PROJECT_ID - GCP project ID (optional, for prod)
 *   INTEXURAOS_ENVIRONMENT - Environment (optional, defaults to development)
 */

/* eslint-disable no-console -- Script uses console for user-facing output */
/* eslint-disable @typescript-eslint/restrict-template-expressions -- Script uses numbers in templates for counts */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Firestore types are external */
/* eslint-disable @typescript-eslint/no-unsafe-call -- Firestore types are external */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Firestore types are external */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- Firestore types are external */
/* eslint-disable @typescript-eslint/strict-boolean-expressions -- Firestore docs.exists check */
/* eslint-disable @typescript-eslint/use-unknown-in-catch-callback-variable -- Script error handling */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { getFirestore } from '@intexuraos/infra-firestore';
import { getErrorMessage, ok, type Result } from '@intexuraos/common-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_CHUNK_SIZE = 8000;
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Service URLs for fetching OpenAPI specs (from ecosystem.config.cjs)
const SERVICE_URLS: Readonly<Record<string, string>> = {
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_NOTION_SERVICE_URL: 'http://localhost:8112',
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://localhost:8113',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://localhost:8114',
  INTEXURAOS_RESEARCH_AGENT_URL: 'http://localhost:8116',
  INTEXURAOS_COMMANDS_AGENT_URL: 'http://localhost:8117',
  INTEXURAOS_ACTIONS_AGENT_URL: 'http://localhost:8118',
  INTEXURAOS_DATA_INSIGHTS_AGENT_URL: 'http://localhost:8119',
  INTEXURAOS_IMAGE_SERVICE_URL: 'http://localhost:8120',
  INTEXURAOS_NOTES_AGENT_URL: 'http://localhost:8121',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122',
  INTEXURAOS_TODOS_AGENT_URL: 'http://localhost:8123',
  INTEXURAOS_BOOKMARKS_AGENT_URL: 'http://localhost:8124',
  INTEXURAOS_CALENDAR_AGENT_URL: 'http://localhost:8125',
  INTEXURAOS_LINEAR_AGENT_URL: 'http://localhost:8126',
  INTEXURAOS_CHAT_AGENT_URL: 'http://localhost:8129',
  INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
  INTEXURAOS_WEB_AGENT_URL: 'http://localhost:8127',
};

/**
 * Document chunk for embedding.
 */
interface DocChunk {
  id: string;
  content: string;
  filePath: string;
  section: string;
  docType: 'markdown' | 'openapi';
  embedding: number[];
}

/**
 * OpenAPI spec structure.
 */
export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths?: Record<string, Record<string, { summary?: string; description?: string }>>;
}

/**
 * Markdown chunk with section info.
 */
export interface MarkdownChunk {
  content: string;
  section: string;
  level: number;
}

/**
 * Error types for the script.
 */
interface EmbedError {
  code: 'NO_API_KEY' | 'FETCH_FAILED' | 'INVALID_OPENAPI' | 'EMBEDDING_FAILED' | 'FIRESTORE_ERROR';
  message: string;
}

/**
 * Parse a markdown file into chunks by headers.
 */
export function parseMarkdown(filePath: string, content: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const lines = content.split('\n');

  let currentChunk: MarkdownChunk | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- Checking if match exists, not extracting groups
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      // Save previous chunk if exists
      if (currentChunk && currentContent.length > 0) {
        chunks.push({
          ...currentChunk,
          content: currentContent.join('\n').trim(),
        });
      }

      // Start new chunk
      const level = headerMatch[1].length;
      const section = headerMatch[2].trim();

      currentChunk = {
        content: '',
        section: section,
        level,
      };
      currentContent = [line];
    } else if (currentChunk) {
      currentContent.push(line);
    }
  }

  // Save last chunk
  if (currentChunk && currentContent.length > 0) {
    chunks.push({
      ...currentChunk,
      content: currentContent.join('\n').trim(),
    });
  }

  // Handle empty files or files without headers
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      content: content.trim(),
      section: 'Introduction',
      level: 1,
    });
  }

  return chunks;
}

/**
 * Split chunks that exceed max size.
 */
export function enforceMaxSize(chunks: MarkdownChunk[], _filePath: string): MarkdownChunk[] {
  const result: MarkdownChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.content.length <= MAX_CHUNK_SIZE) {
      result.push(chunk);
      continue;
    }

    // Split large chunk into smaller parts by paragraphs
    const paragraphs = chunk.content.split('\n\n');
    let currentPart = '';
    let partNumber = 1;

    for (const para of paragraphs) {
      const testContent = currentPart ? `${currentPart}\n\n${para}` : para;

      // If adding this paragraph would exceed max size
      if (testContent.length > MAX_CHUNK_SIZE && currentPart.length > 0) {
        // Save current part and start a new one
        result.push({
          content: currentPart,
          section: `${chunk.section} (part ${partNumber})`,
          level: chunk.level,
        });
        currentPart = para;
        partNumber++;
      } else if (para.length > MAX_CHUNK_SIZE) {
        // Single paragraph exceeds max size - split by character count
        if (currentPart.length > 0) {
          result.push({
            content: currentPart,
            section: `${chunk.section} (part ${partNumber})`,
            level: chunk.level,
          });
          partNumber++;
        }
        // Split the large paragraph into chunks of MAX_CHUNK_SIZE
        for (let i = 0; i < para.length; i += MAX_CHUNK_SIZE) {
          result.push({
            content: para.slice(i, i + MAX_CHUNK_SIZE),
            section: `${chunk.section} (part ${partNumber})`,
            level: chunk.level,
          });
          partNumber++;
        }
        currentPart = '';
      } else {
        currentPart = testContent;
      }
    }

    // Add remaining content
    if (currentPart) {
      result.push({
        content: currentPart,
        section: `${chunk.section} (part ${partNumber})`,
        level: chunk.level,
      });
    }
  }

  return result;
}

/**
 * Generate embeddings for texts via OpenAI API with retry logic.
 */
async function generateEmbeddings(texts: string[]): Promise<Result<number[][], EmbedError>> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return { code: 'NO_API_KEY', message: 'OPENAI_API_KEY environment variable not set' };
  }

  const openai = new OpenAI({ apiKey });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
        encoding_format: 'float',
      });

      const embeddings = response.data.map((item) => item.embedding);
      return ok(embeddings);
    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        const errorMsg = getErrorMessage(error);
        if (errorMsg.includes('429') || errorMsg.includes('rate')) {
          console.log(`  Rate limited, retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
      }

      const message = getErrorMessage(error);
      return { code: 'EMBEDDING_FAILED', message };
    }
  }

  return { code: 'EMBEDDING_FAILED', message: 'Max retries reached' };
}

/**
 * Batch embedding requests to handle rate limits efficiently.
 */
async function batchEmbeddings(texts: string[]): Promise<Result<number[][], EmbedError>> {
  const embeddings: number[][] = [];
  const errors: string[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const result = await generateEmbeddings(batch);

    if (!result.ok) {
      errors.push(`Batch ${i / BATCH_SIZE + 1}: ${result.error.message}`);
      // Add zero embeddings for failed batch to maintain index alignment
      for (const _ of batch) {
        embeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
      }
    } else {
      embeddings.push(...result.value);
    }
  }

  if (errors.length > 0) {
    console.warn(`  Completed with ${errors.length} batch errors`);
  }

  return ok(embeddings);
}

/**
 * Parse OpenAPI spec into chunks by endpoint.
 */
export function parseOpenAPI(filePath: string, spec: OpenAPISpec): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];

  if (!spec.paths) {
    return chunks;
  }

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      const upperMethod = method.toUpperCase();
      const summary = details.summary ?? upperMethod;
      const description = details.description ?? '';
      const parameters = details.parameters
        ? Object.entries(details.parameters)
            .map(([name, param]) => `- ${name}: ${param.description ?? '(no description)'}`)
            .join('\n')
        : '(no parameters)';

      const content = `## ${path}\n\n### ${upperMethod} ${summary}\n\n${description}\n\n**Parameters:**\n${parameters}`;

      chunks.push({
        content,
        section: `${upperMethod} ${path}`,
        level: 2,
      });
    }
  }

  return chunks;
}

/**
 * Find all markdown files in the docs directory.
 */
function findMarkdownFiles(): string[] {
  const docsDir = join(repoRoot, 'docs');

  function walkDir(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath));
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  return walkDir(docsDir);
}

/**
 * Get list of service names that have OpenAPI specs.
 */
function getServiceNames(): string[] {
  // Extract service names from the URLs
  return Object.entries(SERVICE_URLS)
    .filter(
      ([name]) =>
        name.endsWith('_URL') &&
        !name.startsWith('INTEXURAOS_INTERNAL_') &&
        !name.includes('_WEB_APP_URL') &&
        name !== 'INTEXURAOS_GCP_PROJECT_ID'
    )
    .map(([name]) => name.replace('_URL', '').toLowerCase())
    .filter((name) => name !== 'intexuraos' && name !== 'firebase' && name !== 'gcp');
}

/**
 * Convert service name to OpenAPI spec file path.
 */
function getOpenAPIFilePath(serviceName: string): string {
  return `${serviceName}-openapi.json`;
}

/**
 * Convert service name to OpenAPI spec URL.
 */
function getOpenAPIUrl(serviceName: string): string {
  const urlKey = `INTEXURAOS_${serviceName.toUpperCase()}_URL`;
  const baseUrl = SERVICE_URLS[urlKey];
  if (!baseUrl) {
    throw new Error(`No URL found for service: ${serviceName}`);
  }
  return `${baseUrl}/openapi.json`.replace('http://', 'https://'); // Use HTTPS for production
}

/**
 * Fetch OpenAPI spec from a deployed service.
 */
async function fetchOpenAPISpec(serviceName: string): Promise<Result<OpenAPISpec, EmbedError>> {
  try {
    const url = getOpenAPIUrl(serviceName);
    console.log(`  Fetching ${url}...`);

    const response = await fetch(url);
    if (!response.ok) {
      return { code: 'FETCH_FAILED', message: `HTTP ${response.status}: ${response.statusText}` };
    }

    const spec = (await response.json()) as OpenAPISpec;
    return ok(spec);
  } catch (error) {
    const message = getErrorMessage(error);
    return { code: 'FETCH_FAILED', message };
  }
}

/**
 * Upload chunk to Firestore doc_embeddings collection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore types are external
async function uploadChunk(chunk: DocChunk, firestore: any): Promise<void> {
  const collection = firestore.collection('doc_embeddings');
  const docId = `${chunk.docType}:${chunk.id}`;

  const doc = {
    content: chunk.content,
    embedding: chunk.embedding,
    filePath: chunk.filePath,
    section: chunk.section,
    docType: chunk.docType,
    createdAt: new Date(),
  };

  // Get existing document to check if embedding changed
  const existingDoc = await collection.doc(docId).get();
  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    // Only update if embedding changed
    const embeddingChanged =
      JSON.stringify(existingData.embedding) !== JSON.stringify(chunk.embedding);
    if (!embeddingChanged) {
      return; // No change needed
    }
  }

  await collection.doc(docId).set(doc);
}

/**
 * Clean up stale embeddings that are no longer in the current set.
 */
async function cleanStaleEmbeddings(
  currentIds: Set<string>,
  docType: 'markdown' | 'openapi',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore types are external
  firestore: any
): Promise<void> {
  const collection = firestore.collection('doc_embeddings');
  // Prefix is used conceptually but not in code, comment for clarity
  // const prefix = `${docType}:`;

  // Delete all docs with the docType that are not in currentIds
  const snapshot = await collection.where('docType', '==', docType).get();
  const batch = firestore.batch();

  for (const doc of snapshot.docs) {
    const docId = doc.id;
    if (!currentIds.has(docId)) {
      batch.delete(doc.ref);
    }
  }

  await batch.commit();
}

/**
 * Main embedding generation workflow.
 */
async function main(): Promise<void> {
  console.log('📝 Embed Documentation Generation\n');

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable not set');
    process.exit(1);
  }

  // Get project ID for Firestore connection
  const projectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? 'intexuraos-dev';

  // Initialize Firestore
  const firestore = getFirestore();
  console.log(`🔥 Connected to Firestore project: ${projectId}\n`);

  const allChunks: DocChunk[] = [];
  let markdownCount = 0;
  let openapiCount = 0;

  // Process markdown files
  console.log('📄 Processing markdown files...');
  const markdownFiles = findMarkdownFiles();
  markdownCount = markdownFiles.length;

  for (const filePath of markdownFiles) {
    const relativePath = filePath.replace(repoRoot + '/', '');
    console.log(`  Parsing ${relativePath}...`);

    const content = readFileSync(filePath, 'utf-8');
    const chunks = enforceMaxSize(parseMarkdown(filePath, content), filePath);

    for (const chunk of chunks) {
      allChunks.push({
        id: randomUUID(),
        content: chunk.content,
        filePath: relativePath,
        section: `${relativePath} > ${chunk.section}`,
        docType: 'markdown',
        embedding: [], // Will be filled in later
      });
    }
  }

  console.log(`  Generated ${allChunks.length} markdown chunks\n`);

  // Process OpenAPI specs
  console.log('🌐 Processing OpenAPI specs...');
  const serviceNames = getServiceNames();
  openapiCount = serviceNames.length;

  for (const serviceName of serviceNames) {
    console.log(`  Fetching ${serviceName} OpenAPI spec...`);

    const specResult = await fetchOpenAPISpec(serviceName);
    if (!specResult.ok) {
      console.warn(`    ⚠️  Failed: ${specResult.error.message}`);
      continue;
    }

    const spec = specResult.value;
    const filePath = getOpenAPIFilePath(serviceName);

    const chunks = enforceMaxSize(parseOpenAPI(filePath, spec), filePath);

    for (const chunk of chunks) {
      allChunks.push({
        id: randomUUID(),
        content: chunk.content,
        filePath: filePath,
        section: chunk.section,
        docType: 'openapi',
        embedding: [], // Will be filled in later
      });
    }
  }

  console.log(`  Generated ${allChunks.length - markdownCount} OpenAPI chunks\n`);
  console.log(`📊 Total chunks to embed: ${allChunks.length}\n`);

  if (allChunks.length === 0) {
    console.log('No chunks to process. Exiting.');
    return;
  }

  // Generate embeddings
  console.log(
    `🧠 Generating embeddings (${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS} dimensions)...`
  );

  const texts = allChunks.map((c) => c.content);
  const embeddingsResult = await batchEmbeddings(texts);

  if (!embeddingsResult.ok) {
    console.error(`❌ Failed to generate embeddings: ${embeddingsResult.error.message}`);
    process.exit(1);
  }

  const embeddings = embeddingsResult.value;
  console.log(`  Generated ${embeddings.length} embeddings\n`);

  // Assign embeddings to chunks
  for (let i = 0; i < allChunks.length; i++) {
    allChunks[i].embedding = embeddings[i];
  }

  // Upload to Firestore
  console.log('💾 Uploading to Firestore...');

  // Process markdown chunks
  const markdownChunks = allChunks.filter((c) => c.docType === 'markdown');
  const markdownIds = new Set(markdownChunks.map((c) => `markdown:${c.id}`));

  console.log(`  Uploading ${markdownChunks.length} markdown chunks...`);
  for (const chunk of markdownChunks) {
    await uploadChunk(chunk, firestore);
  }

  // Clean up stale markdown embeddings
  console.log('  Cleaning up stale markdown embeddings...');
  await cleanStaleEmbeddings(markdownIds, 'markdown', firestore);

  // Process OpenAPI chunks
  const openapiChunks = allChunks.filter((c) => c.docType === 'openapi');
  const openapiIds = new Set(openapiChunks.map((c) => `openapi:${c.id}`));

  console.log(`  Uploading ${openapiChunks.length} OpenAPI chunks...`);
  for (const chunk of openapiChunks) {
    await uploadChunk(chunk, firestore);
  }

  // Clean up stale OpenAPI embeddings
  console.log('  Cleaning up stale OpenAPI embeddings...');
  await cleanStaleEmbeddings(openapiIds, 'openapi', firestore);

  console.log('\n✅ Embedding generation complete!');
  console.log(`   📄 Processed: ${markdownCount} markdown files, ${openapiCount} OpenAPI specs`);
  console.log(`   🧊 Chunks created: ${allChunks.length}`);
  console.log(`   💾 Uploaded to: doc_embeddings collection in ${projectId}`);
}

// Run the script only when executed directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((error) => {
    const message = getErrorMessage(error);
    console.error(`\n❌ Fatal error: ${message}`);
    process.exit(1);
  });
}

import { readFileSync } from 'node:fs';

function reject() {
  process.exit(1);
}

const [expectedCommitSha, expectedWorkflowRunId, expectedSecretPackageVersion, headersPath] =
  process.argv.slice(2);
if (
  expectedCommitSha === undefined ||
  expectedWorkflowRunId === undefined ||
  expectedSecretPackageVersion === undefined ||
  !/^[1-9]\d*$/.test(expectedSecretPackageVersion) ||
  headersPath === undefined
) {
  reject();
}

let document;
let responseHeaders;
try {
  document = JSON.parse(readFileSync(0, 'utf8'));
  responseHeaders = readFileSync(headersPath, 'utf8');
} catch {
  reject();
}

if (document === null || typeof document !== 'object' || Array.isArray(document)) {
  reject();
}

const expectedKeys = ['commitSha', 'deployedAt', 'secretPackageVersion', 'workflowRunId'];
const actualKeys = Object.keys(document).sort();
if (
  actualKeys.length !== expectedKeys.length ||
  actualKeys.some((key, index) => key !== expectedKeys[index])
) {
  reject();
}

const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const deployedAt = document.deployedAt;
if (
  document.commitSha !== expectedCommitSha ||
  document.workflowRunId !== expectedWorkflowRunId ||
  document.secretPackageVersion !== expectedSecretPackageVersion ||
  typeof deployedAt !== 'string' ||
  !canonicalTimestampPattern.test(deployedAt)
) {
  reject();
}

const parsedTimestamp = new Date(deployedAt);
if (
  !Number.isFinite(parsedTimestamp.getTime()) ||
  parsedTimestamp.toISOString() !== deployedAt.replace(/Z$/, '.000Z')
) {
  reject();
}

const headerBlocks = responseHeaders
  .split(/\r?\n\r?\n/)
  .map((block) => block.trim())
  .filter((block) => /^HTTP\/\S+\s+\d{3}(?:\s|$)/i.test(block));
const finalHeaderBlock = headerBlocks.at(-1);
if (finalHeaderBlock === undefined) {
  reject();
}

const headers = new Map();
for (const line of finalHeaderBlock.split(/\r?\n/).slice(1)) {
  const separator = line.indexOf(':');
  if (separator < 1) continue;
  headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
}

const contentType = headers.get('content-type');
const cacheControl = headers.get('cache-control');
if (
  typeof contentType !== 'string' ||
  !/^application\/json(?:\s*;|\s*$)/i.test(contentType) ||
  typeof cacheControl !== 'string' ||
  !cacheControl
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .includes('no-store')
) {
  reject();
}

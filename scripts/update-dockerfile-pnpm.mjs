#!/usr/bin/env node
/**
 * Update Dockerfiles from npm to pnpm
 */

import { readFile, writeFile } from 'node:fs/promises';
import { glob } from 'glob';

const dockerfiles = [
  ...await glob('apps/*/Dockerfile'),
  ...(await glob('tools/*/Dockerfile')).filter(f => !f.includes('node_modules')),
];

for (const dockerfile of dockerfiles) {
  try {
    let content = await readFile(dockerfile, 'utf-8');
    const original = content;

    // Check if already updated
    if (content.includes('pnpm install')) {
      console.log(`Skipping (already updated): ${dockerfile}`);
      continue;
    }

    // Extract service name from path for filter command
    const match = dockerfile.match(/\/apps\/([^/]+)\/|\/tools\/([^/]+)\//);
    const serviceName = match ? match[1] || match[2] : null;

    // Stage 1: Add pnpm install after FROM node:22-alpine AS builder
    content = content.replace(
      /(FROM node:\d+-alpine AS builder\n)/,
      '$1# Install pnpm\nRUN npm install -g pnpm@9\n\n'
    );

    // Stage 1: Copy workspace files
    content = content.replace(
      /# Copy all package\.json files\nCOPY package\*\.json \.\/\n/,
      `# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
`
    );

    // Stage 1: Change npm ci to pnpm install
    content = content.replace(
      /# Install dependencies\nRUN npm ci\n/,
      '# Install dependencies\nRUN pnpm install --frozen-lockfile\n'
    );

    // Stage 1: Change npm run build -w to pnpm run --filter
    if (serviceName) {
      content = content.replace(
        new RegExp(`RUN npm run build -w @intexuraos/${serviceName}`),
        `RUN pnpm run --filter @intexuraos/${serviceName} build`
      );
    }

    // Stage 2: Add pnpm install after FROM node:22-alpine (second stage)
    content = content.replace(
      /# Stage 2: Production\nFROM node:\d+-alpine\n\nWORKDIR \/app\n\n/,
      '# Stage 2: Production\nFROM node:22-alpine\n\n# Install pnpm\nRUN npm install -g pnpm@9\n\nWORKDIR /app\n\n'
    );

    // Stage 2: Copy workspace files before package.json
    content = content.replace(
      /WORKDIR \/app\n\n# Copy generated production package\.json/,
      'WORKDIR /app\n\n# Copy workspace config and lockfile\nCOPY pnpm-workspace.yaml ./\nCOPY pnpm-lock.yaml ./\n\n# Copy generated production package.json'
    );

    // Stage 2: Change npm install --omit=dev to pnpm install
    content = content.replace(
      /RUN npm install --omit=dev\n/,
      'RUN pnpm install --prod --frozen-lockfile\n'
    );

    if (content !== original) {
      await writeFile(dockerfile, content);
      console.log(`Updated: ${dockerfile}`);
    } else {
      console.log(`No changes needed: ${dockerfile}`);
    }
  } catch (err) {
    console.error(`Error processing ${dockerfile}:`, err.message);
  }
}

console.log('\nDockerfile update complete!');

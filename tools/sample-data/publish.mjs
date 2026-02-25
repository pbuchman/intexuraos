#!/usr/bin/env node
/**
 * Publish sample data to IntexuraOS production Pub/Sub.
 *
 * Usage:
 *   node publish.mjs [data-file] [--topic=commands-ingest] [--user-id=...]
 *
 * Defaults:
 *   data-file:  ./data/notes.json
 *   topic:      intexuraos-commands-ingest-dev
 *   user-id:    google-oauth2|102212401347660567351 (demo account)
 *   project-id: intexuraos-dev-pbuchman
 *
 * Environment:
 *   GOOGLE_APPLICATION_CREDENTIALS must point to a valid service account key.
 */
import { PubSub } from '@google-cloud/pubsub';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v];
    })
);
const positional = args.filter((a) => !a.startsWith('--'));

const PROJECT_ID = flags['project-id'] ?? 'intexuraos-dev-pbuchman';
const TOPIC = flags['topic'] ?? 'intexuraos-commands-ingest-dev';
const USER_ID = flags['user-id'] ?? 'google-oauth2|102212401347660567351';
const dataFile = positional[0] ?? resolve(__dirname, 'data', 'notes.json');

const pubsub = new PubSub({ projectId: PROJECT_ID });
const topic = pubsub.topic(TOPIC);

const items = JSON.parse(readFileSync(dataFile, 'utf-8'));

console.log(`Publishing ${items.length} items to ${TOPIC} (project: ${PROJECT_ID})`);
console.log(`User ID: ${USER_ID}\n`);

let published = 0;
for (const item of items) {
  const event = {
    type: 'command.ingest',
    userId: USER_ID,
    sourceType: item.sourceType ?? 'whatsapp_text',
    externalId: `sample-${item.id}-${Date.now()}`,
    text: item.text,
    ...(item.summary !== undefined && { summary: item.summary }),
    timestamp: new Date().toISOString(),
  };

  const dataBuffer = Buffer.from(JSON.stringify(event));
  const messageId = await topic.publishMessage({ data: dataBuffer });
  published++;
  console.log(
    `  [${published}/${items.length}] ${item.id} (${item.domain ?? 'unknown'}, ${item.readingTime ?? '?'}) -> ${messageId}`
  );
}

console.log(`\nDone. Published ${published} items.`);

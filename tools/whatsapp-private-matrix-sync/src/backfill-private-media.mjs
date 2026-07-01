#!/usr/bin/env node
import { backfillPrivateMedia, createConfig } from './server.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) {
      throw new Error(`unexpected_argument:${entry}`);
    }
    const key = entry.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing_argument_value:${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function buildInput(args) {
  if (typeof args['message-id'] !== 'string' || args['message-id'] === '') {
    throw new Error('missing_message_id');
  }
  if (typeof args['mxc-uri'] !== 'string' || args['mxc-uri'] === '') {
    throw new Error('missing_mxc_uri');
  }

  const media = {
    mxcUri: args['mxc-uri'],
  };
  if (typeof args['mime-type'] === 'string') {
    media.mimeType = args['mime-type'];
  }
  if (typeof args['file-name'] === 'string') {
    media.fileName = args['file-name'];
  }
  if (typeof args['sha256'] === 'string') {
    media.sha256 = args['sha256'];
  }

  const input = {
    messageId: args['message-id'],
    media,
  };
  if (typeof args['matrix-event-id'] === 'string') {
    input.matrixEventId = args['matrix-event-id'];
  }
  return input;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await backfillPrivateMedia(createConfig(), buildInput(args));
    process.stdout.write(`${JSON.stringify({ success: true, data: result })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ success: false, error: message })}\n`);
    process.exitCode = 1;
  }
}

await main();

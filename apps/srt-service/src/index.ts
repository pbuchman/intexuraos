/**
 * SRT Service entry point.
 * Speech Recognition/Transcription via Speechmatics Batch API.
 */
import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
    server.log.info(`SRT Service listening on ${config.host}:${String(config.port)}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void main();


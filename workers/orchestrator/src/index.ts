export * from './types/index.js';
export * from './services/state-persistence.js';
export * from './services/webhook-client.js';
export * from './services/task-dispatcher.js';
export * from './services/log-forwarder.js';
export * from './services/sensitive-file-guard.js';
export * from './routes.js';
export * from './main.js';

// Bootstrap the orchestrator when this module is run directly.
// `start()` is exported from `start.js` (not auto-invoked there) so it can be
// imported by unit tests without triggering the real bootstrap.
import { start } from './start.js';

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n❌ PRECONDITION FAILED: ${message}\n\n`);
  process.exit(1);
});

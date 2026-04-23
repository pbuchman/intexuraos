/**
 * Port availability check.
 *
 * Uses `net.createServer().listen()` to confirm the port is bindable.
 * This is portable (no `lsof` dependency) and testable with real TCP
 * sockets in unit tests.
 */

import { createServer, type Server } from 'node:net';

/** Minimal injectable dependency — tests swap in an in-process fake. */
export interface PortCheckerDeps {
  /**
   * Attempts to bind to the port. Resolves on `listening`, rejects on
   * `error` (e.g. `EADDRINUSE`). Production uses Node's `net` module.
   */
  probe: (port: number) => Promise<void>;
}

function defaultProbe(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      server.close();
      reject(err);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve();
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

const defaultDeps: PortCheckerDeps = { probe: defaultProbe };

/**
 * Throws an `Error` (mentioning the port number) if the port is already
 * in use. Returns normally if the port is free.
 */
export async function ensurePortAvailable(
  port: number,
  deps: PortCheckerDeps = defaultDeps
): Promise<void> {
  try {
    await deps.probe(port);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      throw new Error(
        `Port ${String(port)} is already in use. ` +
          `Find the process: lsof -i :${String(port)}. ` +
          `Or use a different port: export PORT=${String(port + 1)}`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Port ${String(port)} availability check failed: ${detail}`);
  }
}

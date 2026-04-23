import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { ensurePortAvailable, type PortCheckerDeps } from '../../bootstrap/port-checker.js';

async function listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('no address'));
        return;
      }
      resolve({ server, port: address.port });
    });
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

describe('ensurePortAvailable', () => {
  it('resolves when the port is available (real probe)', async () => {
    const { server, port } = await listenOnEphemeralPort();
    await closeServer(server);
    await expect(ensurePortAvailable(port)).resolves.toBeUndefined();
  });

  it('throws with the port number when port is occupied (real probe)', async () => {
    const { server, port } = await listenOnEphemeralPort();
    try {
      await expect(ensurePortAvailable(port)).rejects.toThrow(
        new RegExp(`Port ${String(port)} is already in use`)
      );
    } finally {
      await closeServer(server);
    }
  });

  it('rethrows with EADDRINUSE code via injected probe', async () => {
    const deps: PortCheckerDeps = {
      probe: () => {
        const err = new Error('bind failed') as NodeJS.ErrnoException;
        err.code = 'EADDRINUSE';
        return Promise.reject(err);
      },
    };
    await expect(ensurePortAvailable(1234, deps)).rejects.toThrow(/Port 1234 is already in use/);
  });

  it('wraps non-EADDRINUSE errors and includes the port number', async () => {
    const deps: PortCheckerDeps = {
      probe: () => {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        return Promise.reject(err);
      },
    };
    await expect(ensurePortAvailable(5678, deps)).rejects.toThrow(
      /Port 5678 availability check failed.*permission denied/
    );
  });

  it('wraps non-Error throwables from the probe', async () => {
    const deps: PortCheckerDeps = {
      probe: () => Promise.reject('bare string'),
    };
    await expect(ensurePortAvailable(5679, deps)).rejects.toThrow(/bare string/);
  });
});

import { vi } from 'vitest';
import pino from 'pino';
import type { Firestore } from '@google-cloud/firestore';
import type { ServiceContainer } from '../../services.js';

export function createMockServices(): ServiceContainer {
  return {
    firestore: {
      collection: vi.fn(),
      doc: vi.fn(),
      batch: vi.fn(),
      runTransaction: vi.fn(),
    } as unknown as Firestore,
    logger: createMockLogger(),
  };
}

export function createMockLogger(): pino.Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'info',
    isLevelEnabled: () => true,
  } as unknown as pino.Logger;
}

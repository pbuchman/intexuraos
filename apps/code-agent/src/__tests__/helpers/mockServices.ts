import type { ServiceContainer } from '../../services.js';
import { createMockLogger } from './mockLogger.js';

export function createMockServices(): ServiceContainer {
  return {
    logger: createMockLogger(),
  };
}

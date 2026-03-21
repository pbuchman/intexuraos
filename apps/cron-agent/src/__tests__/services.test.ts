import { describe, it, expect, afterEach } from 'vitest';
import { initServices, getServices, setServices, resetServices } from '../services.js';
import type { ServiceContainer } from '../services.js';

function createFakeContainer(): ServiceContainer {
  return {
    logger: {
      info: (): void => { /* noop */ },
      warn: (): void => { /* noop */ },
      error: (): void => { /* noop */ },
      debug: (): void => { /* noop */ },
    },
    scheduleRepo: {} as never,
    executionRepo: {} as never,
    toolRegistry: {} as never,
    toolCallingClient: {} as never,
    geminiClient: {} as never,
    internalAuthToken: 'test-token',
  };
}

describe('services', () => {
  afterEach(() => {
    resetServices();
  });

  describe('getServices', () => {
    it('throws when container is not initialized', () => {
      expect(() => getServices()).toThrow('Service container not initialized. Call initServices() first.');
    });

    it('returns container after initServices', () => {
      const container = createFakeContainer();
      initServices(container);
      expect(getServices()).toBe(container);
    });
  });

  describe('setServices', () => {
    it('sets the container', () => {
      const container = createFakeContainer();
      setServices(container);
      expect(getServices()).toBe(container);
    });
  });

  describe('resetServices', () => {
    it('resets the container to null', () => {
      const container = createFakeContainer();
      setServices(container);
      resetServices();
      expect(() => getServices()).toThrow();
    });
  });

  describe('initServices', () => {
    it('initializes the container', () => {
      const container = createFakeContainer();
      initServices(container);
      const result = getServices();
      expect(result.internalAuthToken).toBe('test-token');
    });
  });
});

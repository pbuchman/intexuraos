import { describe, it, expect, afterEach, vi } from 'vitest';
import { getServices, setServices, resetServices, initServices } from '../services.js';
import { FakeHellscriptRepository } from './fakeHellscriptRepository.js';
import { FakeWritingConfigRepository } from './fakeWritingConfigRepository.js';
import { FakeIntentInterpreter } from './fakeIntentInterpreter.js';
import { FakeDraftGenerator } from './fakeDraftGenerator.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createContainer(): {
  hellscriptRepository: FakeHellscriptRepository;
  writingConfigRepository: FakeWritingConfigRepository;
  intentInterpreter: FakeIntentInterpreter;
  draftGenerator: FakeDraftGenerator;
  logger: typeof logger;
} {
  return {
    hellscriptRepository: new FakeHellscriptRepository(),
    writingConfigRepository: new FakeWritingConfigRepository(),
    intentInterpreter: new FakeIntentInterpreter(),
    draftGenerator: new FakeDraftGenerator(),
    logger,
  };
}

describe('services', () => {
  afterEach(() => {
    resetServices();
  });

  describe('getServices', () => {
    it('throws when container is not initialized', () => {
      expect(() => getServices()).toThrow(
        'Service container not initialized. Call initServices() first.'
      );
    });

    it('returns container after setServices', () => {
      const container = createContainer();
      setServices(container);

      const result = getServices();
      expect(result).toBe(container);
    });
  });

  describe('resetServices', () => {
    it('resets container to null', () => {
      setServices(createContainer());
      resetServices();
      expect(() => getServices()).toThrow();
    });
  });

  describe('initServices', () => {
    it('initializes container with real implementations', () => {
      const mockClient = {
        generate: vi.fn(),
        research: vi.fn(),
      };

      initServices({
        geminiClient: mockClient,
        logger,
      });

      const services = getServices();
      expect(services.hellscriptRepository).toBeDefined();
      expect(services.writingConfigRepository).toBeDefined();
      expect(services.intentInterpreter).toBeDefined();
      expect(services.draftGenerator).toBeDefined();
      expect(services.logger).toBe(logger);
    });
  });

  describe('setServices', () => {
    it('replaces existing container', () => {
      const first = createContainer();
      const second = createContainer();

      setServices(first);
      setServices(second);

      expect(getServices()).toBe(second);
    });
  });
});

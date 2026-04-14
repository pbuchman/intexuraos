import { describe, it, expect, afterEach, vi } from 'vitest';
import { getServices, setServices, resetServices, initServices, type LlmAdapters } from '../services.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { FakeHellscriptRepository } from './fakeHellscriptRepository.js';
import { FakeWritingConfigRepository } from './fakeWritingConfigRepository.js';
import { FakeUserServiceClient, FakeLlmGenerateClient } from './fakeUserServiceClient.js';
import pino from 'pino'; // @allow-pino-import -- test infrastructure only

const logger = pino({ level: 'silent' });

function createContainer(): {
  hellscriptRepository: FakeHellscriptRepository;
  writingConfigRepository: FakeWritingConfigRepository;
  userServiceClient: FakeUserServiceClient;
  createLlmAdapters: (llmClient: LlmGenerateClient) => LlmAdapters;
  logger: typeof logger;
} {
  const fakeInterpreter = { interpret: vi.fn() };
  const fakeDraftGen = { generate: vi.fn() };
  return {
    hellscriptRepository: new FakeHellscriptRepository(),
    writingConfigRepository: new FakeWritingConfigRepository(),
    userServiceClient: new FakeUserServiceClient(new FakeLlmGenerateClient()),
    createLlmAdapters: (_llmClient: LlmGenerateClient): LlmAdapters => ({
      interpreter: fakeInterpreter,
      draftGenerator: fakeDraftGen,
    }),
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
      const fakeUserServiceClient = new FakeUserServiceClient(new FakeLlmGenerateClient());

      initServices({
        userServiceClient: fakeUserServiceClient,
        logger,
      });

      const services = getServices();
      expect(services.hellscriptRepository).toBeDefined();
      expect(services.writingConfigRepository).toBeDefined();
      expect(services.userServiceClient).toBe(fakeUserServiceClient);
      expect(services.createLlmAdapters).toBeDefined();
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

/**
 * Service container tests for chat-agent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetFirestore } from '@intexuraos/infra-firestore';
import { getServices, setServices, resetServices, initializeServices, type ServiceContainer } from '../services.js';

describe('chat-agent services', () => {
  beforeEach(() => {
    process.env['INTEXURAOS_OPENAI_API_KEY'] = 'test-key';
    process.env['INTEXURAOS_GCP_PROJECT_ID'] = 'test-project';
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    delete process.env['INTEXURAOS_OPENAI_API_KEY'];
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
  });

  describe('getServices', () => {
    it('should throw when container not initialized', () => {
      resetServices();
      expect(() => getServices()).toThrow('Service container not initialized');
    });

    it('should return container after initialization', () => {
      initializeServices();
      const services = getServices();
      expect(services).toBeDefined();
      expect(typeof services.generateId).toBe('function');
      expect(services.embeddingRepository).toBeDefined();
      expect(services.embeddingClient).toBeDefined();
    });
  });

  describe('setServices', () => {
    it('should set custom service container', () => {
      const mockLogger = {
        level: 'info',
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        fatal: () => undefined,
        trace: () => undefined,
        silent: () => undefined,
        msgPrefix: '',
      } as const;
      const mockLlmClient = {
        async generate(): Promise<{ ok: true; value: { response: string } }> {
          return { ok: true, value: { response: 'test' } };
        },
      };

      const customServices: ServiceContainer = {
        generateId: () => 'custom-id',
        embeddingRepository: null as unknown as ServiceContainer['embeddingRepository'],
        embeddingClient: null as unknown as ServiceContainer['embeddingClient'],
        llmClient: mockLlmClient as ServiceContainer['llmClient'],
        logger: mockLogger as unknown as ServiceContainer['logger'],
      };
      setServices(customServices);
      const services = getServices();
      expect(services.generateId()).toBe('custom-id');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', (): void => {
      initializeServices();
      const services = getServices();
      const id1 = services.generateId();
      const id2 = services.generateId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });
  });

  describe('resetServices', () => {
    it('should reset service container', () => {
      initializeServices();
      expect(() => getServices()).not.toThrow();
      resetServices();
      expect(() => getServices()).toThrow('Service container not initialized');
    });
  });
});

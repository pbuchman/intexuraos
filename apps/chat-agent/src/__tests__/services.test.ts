/**
 * Service container tests for chat-agent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getServices, setServices, resetServices, initializeServices, type ServiceContainer } from '../services.js';

describe('chat-agent services', () => {
  beforeEach(() => {
    process.env['INTEXURAOS_OPENAI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    resetServices();
    delete process.env['INTEXURAOS_OPENAI_API_KEY'];
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
      const customServices: ServiceContainer = {
        generateId: () => 'custom-id',
        embeddingRepository: null as unknown as ServiceContainer['embeddingRepository'],
        embeddingClient: null as unknown as ServiceContainer['embeddingClient'],
      };
      setServices(customServices);
      const services = getServices();
      expect(services.generateId()).toBe('custom-id');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
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

/**
 * Service container tests for chat-agent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getServices, setServices, resetServices, initializeServices, type ServiceContainer } from '../services.js';

describe('chat-agent services', () => {
  afterEach(() => {
    resetServices();
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
    });
  });

  describe('setServices', () => {
    it('should set custom service container', () => {
      const customServices: ServiceContainer = {
        generateId: () => 'custom-id',
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

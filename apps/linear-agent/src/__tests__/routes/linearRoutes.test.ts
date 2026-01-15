/**
 * Tests for Linear API routes.
 *
 * NOTE: Full integration tests require server implementation (task 2-1-server).
 * This file verifies route exports and basic structure.
 */
import { describe, expect, it } from 'vitest';
import { linearRoutes } from '../../routes/linearRoutes.js';
import { internalRoutes } from '../../routes/internalRoutes.js';

describe('Linear Routes', () => {
  describe('linearRoutes', () => {
    it('exports a Fastify plugin function', () => {
      expect(typeof linearRoutes).toBe('function');
      expect(linearRoutes.length).toBeGreaterThanOrEqual(2); // FastifyPluginCallback signature
    });
  });

  describe('internalRoutes', () => {
    it('exports a Fastify plugin function', () => {
      expect(typeof internalRoutes).toBe('function');
      expect(internalRoutes.length).toBeGreaterThanOrEqual(2); // FastifyPluginCallback signature
    });
  });
});

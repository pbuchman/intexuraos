import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, initServices, resetServices, setServices } from '../services.js';
import { FakeLinkPreviewFetcher, FakePageSummaryService } from './fakes.js';

describe('services', () => {
  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_CRAWL4AI_API_KEY', 'test-key');
  });

  afterEach(() => {
    resetServices();
    vi.unstubAllEnvs();
  });

  describe('initServices', () => {
    it('initializes services with real implementations', () => {
      initServices();

      const services = getServices();

      expect(services.linkPreviewFetcher).toBeDefined();
      expect(typeof services.linkPreviewFetcher.fetchPreview).toBe('function');
      expect(services.pageSummaryService).toBeDefined();
      expect(typeof services.pageSummaryService.summarizePage).toBe('function');
    });

    it('throws error when CRAWL4AI_API_KEY is missing', () => {
      vi.unstubAllEnvs();

      expect(() => initServices()).toThrow('INTEXURAOS_CRAWL4AI_API_KEY is required');
    });
  });

  describe('getServices', () => {
    it('throws error when services not initialized', () => {
      expect(() => getServices()).toThrow('Services not initialized');
    });

    it('returns services after initialization', () => {
      initServices();

      expect(() => getServices()).not.toThrow();
    });
  });

  describe('setServices', () => {
    it('allows setting custom services for testing', () => {
      const fakeFetcher = new FakeLinkPreviewFetcher();
      const fakeSummary = new FakePageSummaryService();
      setServices({ linkPreviewFetcher: fakeFetcher, pageSummaryService: fakeSummary });

      const services = getServices();

      expect(services.linkPreviewFetcher).toBe(fakeFetcher);
      expect(services.pageSummaryService).toBe(fakeSummary);
    });
  });

  describe('resetServices', () => {
    it('clears services making getServices throw', () => {
      initServices();
      resetServices();

      expect(() => getServices()).toThrow('Services not initialized');
    });
  });
});

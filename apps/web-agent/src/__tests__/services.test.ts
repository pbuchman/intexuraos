import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServices, initServices, resetServices, setServices } from '../services.js';
import {
  FakeLinkPreviewFetcher,
  FakePageContentFetcher,
  FakeLlmSummarizer,
  FakeUserServiceClient,
} from './fakes.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';

describe('services', () => {
  const mockPricingContext = new FakePricingContext();

  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_CRAWL4AI_API_KEY', 'test-key');
  });

  afterEach(() => {
    resetServices();
    vi.unstubAllEnvs();
  });

  describe('initServices', () => {
    it('initializes services with real implementations', () => {
      initServices({
        crawl4aiApiKey: 'test-key',
        userServiceUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
        pricingContext: mockPricingContext,
      });

      const services = getServices();

      expect(services.linkPreviewFetcher).toBeDefined();
      expect(typeof services.linkPreviewFetcher.fetchPreview).toBe('function');
      expect(services.pageContentFetcher).toBeDefined();
      expect(typeof services.pageContentFetcher.fetchPageContent).toBe('function');
      expect(services.llmSummarizer).toBeDefined();
      expect(typeof services.llmSummarizer.summarize).toBe('function');
      expect(services.userServiceClient).toBeDefined();
      expect(typeof services.userServiceClient.getLlmClient).toBe('function');
    });

    it('throws error when services not initialized with dependencies', () => {
      expect(() => getServices()).toThrow('Services not initialized');
    });
  });

  describe('getServices', () => {
    it('throws error when services not initialized', () => {
      expect(() => getServices()).toThrow('Services not initialized');
    });

    it('returns services after initialization', () => {
      initServices({
        crawl4aiApiKey: 'test-key',
        userServiceUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
        pricingContext: mockPricingContext,
      });

      expect(() => getServices()).not.toThrow();
    });
  });

  describe('setServices', () => {
    it('allows setting custom services for testing', () => {
      const fakeFetcher = new FakeLinkPreviewFetcher();
      const fakeContentFetcher = new FakePageContentFetcher();
      const fakeSummarizer = new FakeLlmSummarizer();
      const fakeUserService = new FakeUserServiceClient();

      setServices({
        linkPreviewFetcher: fakeFetcher,
        pageContentFetcher: fakeContentFetcher,
        llmSummarizer: fakeSummarizer,
        userServiceClient: fakeUserService,
      });

      const services = getServices();

      expect(services.linkPreviewFetcher).toBe(fakeFetcher);
      expect(services.pageContentFetcher).toBe(fakeContentFetcher);
      expect(services.llmSummarizer).toBe(fakeSummarizer);
      expect(services.userServiceClient).toBe(fakeUserService);
    });
  });

  describe('resetServices', () => {
    it('clears services making getServices throw', () => {
      initServices({
        crawl4aiApiKey: 'test-key',
        userServiceUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
        pricingContext: mockPricingContext,
      });
      resetServices();

      expect(() => getServices()).toThrow('Services not initialized');
    });
  });
});

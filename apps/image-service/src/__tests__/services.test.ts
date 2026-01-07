import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  getServices,
  setServices,
  resetServices,
  initializeServices,
  type ServiceContainer,
} from '../services.js';
import {
  FakeGeneratedImageRepository,
  FakeImageGenerator,
  FakeImageStorage,
  FakePromptGenerator,
  FakeUserServiceClient,
} from './fakes.js';

const fakePricingContext = new FakePricingContext();

describe('services', () => {
  beforeEach(() => {
    process.env['INTEXURAOS_USER_SERVICE_URL'] = 'http://localhost:8110';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-token';
    process.env['INTEXURAOS_IMAGE_BUCKET'] = 'test-bucket';
  });

  afterEach(() => {
    resetServices();
  });

  describe('getServices', () => {
    it('throws when container is not initialized', () => {
      expect(() => getServices()).toThrow(
        'Service container not initialized. Call initializeServices() first.'
      );
    });

    it('returns container after setServices', () => {
      const fakeRepo = new FakeGeneratedImageRepository();
      const fakeImageGenerator = new FakeImageGenerator();
      const fakeImageStorage = new FakeImageStorage();
      const fakePromptGenerator = new FakePromptGenerator();
      const fakeUserServiceClient = new FakeUserServiceClient();

      const container: ServiceContainer = {
        generatedImageRepository: fakeRepo,
        imageStorage: fakeImageStorage,
        userServiceClient: fakeUserServiceClient,
        pricingContext: fakePricingContext,
        createPromptGenerator: () => fakePromptGenerator,
        createImageGenerator: () => fakeImageGenerator,
        generateId: () => 'test-id',
      };

      setServices(container);

      expect(getServices()).toBe(container);
    });
  });

  describe('initializeServices', () => {
    it('initializes services from environment', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      expect(services.generatedImageRepository).toBeDefined();
      expect(services.createImageGenerator).toBeDefined();
      expect(services.userServiceClient).toBeDefined();
      expect(services.createPromptGenerator).toBeDefined();
      expect(services.generateId).toBeDefined();
    });

    it('createPromptGenerator returns google adapter for google provider', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      const generator = services.createPromptGenerator('google', 'test-key', 'test-user-id');

      expect(generator).toBeDefined();
      expect(generator.generateThumbnailPrompt).toBeDefined();
    });

    it('createPromptGenerator returns openai adapter for openai provider', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      const generator = services.createPromptGenerator('openai', 'test-key', 'test-user-id');

      expect(generator).toBeDefined();
      expect(generator.generateThumbnailPrompt).toBeDefined();
    });

    it('createImageGenerator returns OpenAI generator for gpt-image-1', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      const generator = services.createImageGenerator(LlmModels.GPTImage1, 'test-key', 'test-user-id');

      expect(generator).toBeDefined();
      expect(generator.generate).toBeDefined();
    });

    it('createImageGenerator returns Google generator for gemini-2.5-flash-image', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      const generator = services.createImageGenerator(
        LlmModels.Gemini25FlashImage,
        'test-key',
        'test-user-id'
      );

      expect(generator).toBeDefined();
      expect(generator.generate).toBeDefined();
    });

    it('generateId returns a UUID', () => {
      initializeServices(fakePricingContext);

      const services = getServices();
      const id = services.generateId();

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('resetServices', () => {
    it('clears the container', () => {
      initializeServices(fakePricingContext);
      expect(() => getServices()).not.toThrow();

      resetServices();
      expect(() => getServices()).toThrow();
    });
  });
});

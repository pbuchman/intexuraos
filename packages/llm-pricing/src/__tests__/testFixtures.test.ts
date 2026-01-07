import { describe, expect, it } from 'vitest';
import {
  TEST_PRICING,
  TEST_IMAGE_PRICING,
  FakePricingContext,
  createFakePricingContext,
} from '../testFixtures.js';

describe('testFixtures', () => {
  describe('TEST_PRICING', () => {
    it('has default values', () => {
      expect(TEST_PRICING.inputPricePerMillion).toBe(1.0);
      expect(TEST_PRICING.outputPricePerMillion).toBe(2.0);
    });
  });

  describe('TEST_IMAGE_PRICING', () => {
    it('has image pricing with multiple sizes', () => {
      expect(TEST_IMAGE_PRICING.inputPricePerMillion).toBe(0);
      expect(TEST_IMAGE_PRICING.outputPricePerMillion).toBe(0);
      expect(TEST_IMAGE_PRICING.imagePricing).toBeDefined();
      expect(TEST_IMAGE_PRICING.imagePricing?.['1024x1024']).toBe(0.04);
      expect(TEST_IMAGE_PRICING.imagePricing?.['1536x1024']).toBe(0.08);
      expect(TEST_IMAGE_PRICING.imagePricing?.['1024x1536']).toBe(0.08);
    });
  });

  describe('FakePricingContext', () => {
    it('returns test pricing for regular models', () => {
      const context = new FakePricingContext();

      const pricing = context.getPricing('gemini-2.5-pro');
      expect(pricing.inputPricePerMillion).toBe(1.0);
      expect(pricing.outputPricePerMillion).toBe(2.0);
    });

    it('returns image pricing for gpt-image-1', () => {
      const context = new FakePricingContext();

      const pricing = context.getPricing('gpt-image-1');
      expect(pricing.inputPricePerMillion).toBe(0);
      expect(pricing.imagePricing?.['1024x1024']).toBe(0.04);
    });

    it('returns image pricing for gemini-2.5-flash-image', () => {
      const context = new FakePricingContext();

      const pricing = context.getPricing('gemini-2.5-flash-image');
      expect(pricing.inputPricePerMillion).toBe(0);
      expect(pricing.imagePricing?.['1024x1024']).toBe(0.04);
    });

    it('hasPricing always returns true', () => {
      const context = new FakePricingContext();

      expect(context.hasPricing('gemini-2.5-pro')).toBe(true);
      expect(context.hasPricing('gpt-5.2')).toBe(true);
    });

    it('validateModels does not throw', () => {
      const context = new FakePricingContext();

      expect(() => context.validateModels(['gemini-2.5-pro', 'gpt-5.2'])).not.toThrow();
    });

    it('validateAllModels does not throw', () => {
      const context = new FakePricingContext();

      expect(() => context.validateAllModels()).not.toThrow();
    });

    it('getModelsWithPricing returns all 14 models', () => {
      const context = new FakePricingContext();

      const models = context.getModelsWithPricing();
      expect(models).toHaveLength(14);
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gpt-image-1');
      expect(models).toContain('claude-opus-4-5-20251101');
      expect(models).toContain('sonar-pro');
    });

    it('allows custom pricing in constructor', () => {
      const customPricing = {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 10.0,
      };
      const context = new FakePricingContext(customPricing);

      const pricing = context.getPricing('gemini-2.5-pro');
      expect(pricing.inputPricePerMillion).toBe(5.0);
      expect(pricing.outputPricePerMillion).toBe(10.0);
    });

    it('allows custom image pricing in constructor', () => {
      const customImagePricing = {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.10 },
      };
      const context = new FakePricingContext(TEST_PRICING, customImagePricing);

      const pricing = context.getPricing('gpt-image-1');
      expect(pricing.imagePricing?.['1024x1024']).toBe(0.10);
    });
  });

  describe('createFakePricingContext', () => {
    it('creates context with default pricing', () => {
      const context = createFakePricingContext();

      expect(context).toBeInstanceOf(FakePricingContext);
      expect(context.getPricing('gemini-2.5-pro').inputPricePerMillion).toBe(1.0);
    });

    it('creates context with custom pricing', () => {
      const customPricing = {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 6.0,
      };
      const context = createFakePricingContext(customPricing);

      expect(context.getPricing('gpt-5.2').inputPricePerMillion).toBe(3.0);
    });

    it('creates context with custom image pricing', () => {
      const customImagePricing = {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        imagePricing: { '1024x1024': 0.05 },
      };
      const context = createFakePricingContext(TEST_PRICING, customImagePricing);

      expect(context.getPricing('gpt-image-1').imagePricing?.['1024x1024']).toBe(0.05);
    });
  });
});


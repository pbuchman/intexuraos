# 0-1: Migration 011 — New Pricing Structure

## Status: ✅ DONE

## Tier: 0 (Setup)

## Context

Nowa struktura Firestore dla pricing: `settings/llm_pricing/{provider}`.

## Problem

Obecna struktura `app_settings/llm_pricing` jest flat — jeden dokument z wszystkimi modelami.

## Note

Migracja ma numer 011 (nie 012) - była początkowo utworzona jako 012 ale przywrócona do 011
ponieważ to jest sekwencyjny numer w tym branchu.

## Scope

- Migration file migrations/011_new-pricing-structure.mjs
- 4 dokumenty: google, openai, anthropic, perplexity
- Update firestore-collections.json (add settings collection)

## Approach

Stwórz nową kolekcję, nie modyfikuj starej.

## Data Structure

```javascript
// settings/llm_pricing/google
{
  provider: 'google',
  models: {
    'gemini-2.5-pro': {
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10.0,
      groundingCostPerRequest: 0.035,
    },
    'gemini-2.5-flash': {
      inputPricePerMillion: 0.3,
      outputPricePerMillion: 2.5,
      groundingCostPerRequest: 0.035,
    },
    'gemini-2.0-flash': {
      inputPricePerMillion: 0.1,
      outputPricePerMillion: 0.4,
      groundingCostPerRequest: 0.035,
    },
    'gemini-2.5-flash-image': {
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      imagePricing: {
        '1024x1024': 0.03,
        '1536x1024': 0.04,
        '1024x1536': 0.04,
      },
    },
  },
  updatedAt: '2026-01-05T12:00:00Z',
}
```

## Steps

- [x] Create migrations/011_new-pricing-structure.mjs
- [x] Add google provider document (4 models)
- [x] Add openai provider document (4 models including gpt-image-1)
- [x] Add anthropic provider document (3 models)
- [x] Add perplexity provider document (3 models with useProviderCost: true)
- [x] Update firestore-collections.json: add "settings" with owner "app-settings-service"

## Definition of Done

- [x] Migration runs without errors
- [x] 4 documents created in settings/llm_pricing/
- [x] npm run ci passes

## Created Files

- migrations/011_new-pricing-structure.mjs
- firestore-collections.json (updated)

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-0-llm-contract-pricing-types.md.

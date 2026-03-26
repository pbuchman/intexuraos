/**
 * Tests for OpenRouterModelSelector.
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterModelSelector } from '../OpenRouterModelSelector.js';
import type { OpenRouterModelInfo } from '@/services/researchAgentApi.types';

const TEST_MODELS: OpenRouterModelInfo[] = [
  {
    id: 'x-ai/grok-4-fast',
    name: 'Grok 4 Fast',
    provider: 'OpenRouter',
    contextLength: 512000,
    pricing: {
      inputPricePerMillion: 0.003,
      outputPricePerMillion: 15.5,
    },
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
];

describe('OpenRouterModelSelector', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders per-million pricing without NaN values', () => {
    render(
      React.createElement(OpenRouterModelSelector, {
        availableModels: TEST_MODELS,
        selectedModelIds: [],
        onChange: vi.fn(),
      })
    );

    expect(screen.getByText('$0.0030/M in')).toBeTruthy();
    expect(screen.getByText('$15.50/M out')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

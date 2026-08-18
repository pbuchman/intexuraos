/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmKeysResponse } from '@/services/llmKeysApi.types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getLlmKeys: vi.fn(),
  setLlmKey: vi.fn(),
  deleteLlmKey: vi.fn(),
  testLlmKey: vi.fn(),
  updateLlmPreferences: vi.fn(),
  updateIntexAgentModel: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    user: { sub: string };
    getAccessToken: typeof mocks.getAccessToken;
  } => ({
    user: { sub: 'auth0|user-1' },
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/llmKeysApi', () => ({
  getLlmKeys: mocks.getLlmKeys,
  setLlmKey: mocks.setLlmKey,
  deleteLlmKey: mocks.deleteLlmKey,
  testLlmKey: mocks.testLlmKey,
  updateLlmPreferences: mocks.updateLlmPreferences,
  updateIntexAgentModel: mocks.updateIntexAgentModel,
}));

vi.mock('@/components', async () => {
  const { OpenRouterKeyCard } = await vi.importActual<
    typeof import('@/components/OpenRouterKeyCard')
  >('@/components/OpenRouterKeyCard');
  return {
    OpenRouterKeyCard,
    IntexAgentModelCard: (): null => null,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <div>{children}</div>
    ),
    Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <section>{children}</section>
    ),
  };
});

import { ApiKeysSettingsPage } from '../ApiKeysSettingsPage.js';

const initialKeys: LlmKeysResponse = {
  defaultModel: 'or:minimax/minimax-m3',
  fallbackModel: null,
  openrouter: null,
  accessSource: 'platform',
  testResults: { openrouter: null },
  intexAgentModelSelector: { status: 'unavailable' },
};

describe('ApiKeysSettingsPage with useLlmKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('token');
    mocks.setLlmKey.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('keeps the post-save auto-test error mounted across a delayed key refresh', async () => {
    let resolveRefresh!: (keys: LlmKeysResponse) => void;
    mocks.getLlmKeys
      .mockResolvedValueOnce(initialKeys)
      .mockImplementationOnce(
        () =>
          new Promise<LlmKeysResponse>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    mocks.testLlmKey.mockRejectedValue(new Error('Test endpoint unavailable'));

    render(<ApiKeysSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add personal key' }));
    fireEvent.change(screen.getByLabelText('OpenRouter API Key'), {
      target: { value: 'sk-or-12345678901234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.getLlmKeys).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: 'OpenRouter API key' })).toBeInTheDocument();

    resolveRefresh({
      ...initialKeys,
      openrouter: 'sk-or-...7890',
      accessSource: 'user',
    });

    expect(
      await screen.findByText(
        'API key saved, but automatic testing failed. Use Test to retry.',
      ),
    ).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */

import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntexAgentModels } from '@intexuraos/llm-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UseIntexAgentModelResult } from '@/hooks/useIntexAgentModel';
import { IntexAgentModelCard } from '../IntexAgentModelCard.js';

type AvailableSelector = Extract<UseIntexAgentModelResult, { availability: 'available' }>;

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createSelector(overrides: Partial<AvailableSelector> = {}): AvailableSelector {
  return {
    availability: 'available',
    writable: true,
    explicitModel: null,
    effectiveModel: IntexAgentModels.DeepSeekV4Flash,
    revision: 3,
    options: [
      { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
      { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
      { id: IntexAgentModels.Gemini36Flash, label: 'Gemini 3.6 Flash' },
    ],
    savingIntexAgentModel: false,
    intexAgentModelError: null,
    setIntexAgentModel: vi.fn().mockResolvedValue('applied'),
    ...overrides,
  };
}

describe('IntexAgentModelCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the accessible platform-key-backed selector with the frozen option order', () => {
    render(<IntexAgentModelCard selector={createSelector()} />);

    expect(screen.getByRole('heading', { name: 'Intex Agent model' })).toBeInTheDocument();
    const select = screen.getByLabelText('Intex Agent model');
    expect(select).toHaveAccessibleName('Intex Agent model');
    expect(screen.getByText(/WhatsApp Assistant/i)).toBeInTheDocument();
    expect(screen.getByText(/IntexuraOS platform key/i)).toBeInTheDocument();
    expect(Array.from((select as HTMLSelectElement).options, (option) => option.text)).toEqual([
      'DeepSeek V4 Flash',
      'MiniMax M3',
      'Gemini 3.6 Flash',
    ]);
  });

  it('displays DeepSeek for the absent preference and only renders reset for an explicit preference', () => {
    const { rerender } = render(<IntexAgentModelCard selector={createSelector()} />);

    expect(screen.getByLabelText('Intex Agent model')).toHaveValue(IntexAgentModels.DeepSeekV4Flash);
    expect(screen.queryByRole('button', { name: /Use default Intex Agent model/i })).not.toBeInTheDocument();

    rerender(
      <IntexAgentModelCard
        selector={createSelector({
          explicitModel: IntexAgentModels.Gemini36Flash,
          effectiveModel: IntexAgentModels.Gemini36Flash,
        })}
      />
    );

    expect(screen.getByLabelText('Intex Agent model')).toHaveValue(IntexAgentModels.Gemini36Flash);
    expect(screen.getByRole('button', { name: /Use default Intex Agent model/i })).toBeInTheDocument();
  });

  it('saves a selection immediately and resets only the independent persisted preference', async () => {
    const user = userEvent.setup();
    const setIntexAgentModel = vi.fn().mockResolvedValue('applied');
    render(
      <IntexAgentModelCard
        selector={createSelector({
          explicitModel: IntexAgentModels.DeepSeekV4Flash,
          setIntexAgentModel,
        })}
      />
    );

    await user.selectOptions(screen.getByLabelText('Intex Agent model'), IntexAgentModels.MiniMaxM3);
    expect(setIntexAgentModel).toHaveBeenCalledWith(IntexAgentModels.MiniMaxM3);
    expect(screen.queryByRole('button', { name: /save|confirm/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Use default Intex Agent model/i }));
    expect(setIntexAgentModel).toHaveBeenLastCalledWith(null);
  });

  it('keeps the selector enabled while saving, accepts the latest intent, and restores focus after settlement', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<'applied'>();
    const setIntexAgentModel = vi.fn().mockReturnValue(deferred.promise);
    render(
      <IntexAgentModelCard
        selector={createSelector({ savingIntexAgentModel: true, setIntexAgentModel })}
      />
    );

    const select = screen.getByLabelText('Intex Agent model');
    expect(select).toHaveAttribute('aria-busy', 'true');
    expect(select).toBeEnabled();

    await user.selectOptions(select, IntexAgentModels.MiniMaxM3);
    await user.selectOptions(select, IntexAgentModels.Gemini36Flash);
    expect(setIntexAgentModel).toHaveBeenNthCalledWith(1, IntexAgentModels.MiniMaxM3);
    expect(setIntexAgentModel).toHaveBeenNthCalledWith(2, IntexAgentModels.Gemini36Flash);

    deferred.resolve('applied');
    await Promise.resolve();
    expect(select).toHaveFocus();
  });

  it('restores focus after settlement when StrictMode replays the mount effect', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<'applied'>();
    const setIntexAgentModel = vi.fn().mockReturnValue(deferred.promise);
    render(
      <StrictMode>
        <button type="button">Elsewhere</button>
        <IntexAgentModelCard selector={createSelector({ setIntexAgentModel })} />
      </StrictMode>
    );

    const select = screen.getByLabelText('Intex Agent model');
    await user.selectOptions(select, IntexAgentModels.MiniMaxM3);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    deferred.resolve('applied');

    await waitFor(() => {
      expect(select).toHaveFocus();
    });
  });

  it('associates only the stable helper and safe selector error with the control', () => {
    const { rerender } = render(<IntexAgentModelCard selector={createSelector()} />);
    const select = screen.getByLabelText('Intex Agent model');
    expect(select).toHaveAttribute('aria-describedby', 'intex-agent-model-description');
    expect(screen.queryByText('legacy raw error sentinel')).not.toBeInTheDocument();

    rerender(
      <IntexAgentModelCard
        selector={createSelector({ intexAgentModelError: 'Failed to save Intex Agent model' })}
      />
    );
    expect(screen.getByLabelText('Intex Agent model')).toHaveAttribute(
      'aria-describedby',
      'intex-agent-model-description intex-agent-model-error'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save Intex Agent model');
  });

  it('keeps keyboard-reachable controls in a narrow responsive layout without fixed widths', async () => {
    const user = userEvent.setup();
    const setIntexAgentModel = vi.fn().mockResolvedValue('applied');
    render(
      <div className="w-[320px]">
        <IntexAgentModelCard
          selector={createSelector({
            explicitModel: IntexAgentModels.MiniMaxM3,
            effectiveModel: IntexAgentModels.MiniMaxM3,
            setIntexAgentModel,
          })}
        />
      </div>
    );

    await user.tab();
    expect(screen.getByLabelText('Intex Agent model')).toHaveFocus();
    await user.tab();
    const reset = screen.getByRole('button', { name: /Use default Intex Agent model/i });
    expect(reset).toHaveFocus();
    await user.keyboard(' ');
    expect(setIntexAgentModel).toHaveBeenCalledWith(null);

    const layout = screen.getByLabelText('Intex Agent model').closest('[class*="flex-col"]');
    expect(layout).toHaveClass('flex-col');
    expect(layout).toHaveClass('sm:flex-row');
    expect(layout?.className).not.toMatch(/(?:^|\s)w-(?:\d+|\[\d+px\])(?:\s|$)/);
  });
});

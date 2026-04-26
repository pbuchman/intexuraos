/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InputContextCard } from '../InputContextCard.js';

afterEach(() => {
  cleanup();
});

describe('InputContextCard', () => {
  it('shows Add button when below max', () => {
    const onAdd = vi.fn();
    render(
      <InputContextCard
        inputContexts={[]}
        maxInputContexts={5}
        maxContextLength={60000}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
        submitting={false}
        savingDraft={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Input Context/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('hides Add button when at max', () => {
    render(
      <InputContextCard
        inputContexts={['a', 'b', 'c', 'd', 'e']}
        maxInputContexts={5}
        maxContextLength={60000}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
        submitting={false}
        savingDraft={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add Input Context/i })).toBeNull();
    expect(screen.getByText(/Maximum 5 contexts allowed/)).toBeTruthy();
  });

  it('forwards updates with index', () => {
    const onUpdate = vi.fn();
    render(
      <InputContextCard
        inputContexts={['existing']}
        maxInputContexts={5}
        maxContextLength={60000}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={onUpdate}
        submitting={false}
        savingDraft={false}
      />,
    );
    const textarea = screen.getByDisplayValue('existing');
    fireEvent.change(textarea, { target: { value: 'updated' } });
    expect(onUpdate).toHaveBeenCalledWith(0, 'updated');
  });
});

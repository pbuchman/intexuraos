/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResearchActionBar } from '../ResearchActionBar.js';

afterEach(() => {
  cleanup();
});

const baseProps = {
  isEditMode: false,
  prompt: 'a valid prompt',
  canSubmit: true,
  submitting: false,
  savingDraft: false,
  discarding: false,
  validating: false,
  disabledReason: undefined,
  onDiscardClick: vi.fn(),
  onSaveDraft: vi.fn(),
  onSubmit: vi.fn(),
};

describe('ResearchActionBar', () => {
  it('hides Discard Draft button when not in edit mode', () => {
    render(<ResearchActionBar {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Discard Draft/i })).toBeNull();
  });

  it('shows Discard Draft button in edit mode', () => {
    render(<ResearchActionBar {...baseProps} isEditMode={true} />);
    expect(screen.getByRole('button', { name: /Discard Draft/i })).toBeTruthy();
  });

  it('disables submit when canSubmit is false', () => {
    const onSubmit = vi.fn();
    render(<ResearchActionBar {...baseProps} canSubmit={false} onSubmit={onSubmit} />);
    const button = screen.getByRole('button', { name: /Start Research/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables submit when validating', () => {
    render(<ResearchActionBar {...baseProps} validating={true} />);
    const buttons = screen.getAllByRole('button');
    const submitButton = buttons.find((b) => (b as HTMLButtonElement).disabled);
    expect(submitButton).toBeTruthy();
  });

  it('triggers onSubmit when Start Research is clicked', () => {
    const onSubmit = vi.fn();
    render(<ResearchActionBar {...baseProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Start Research/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

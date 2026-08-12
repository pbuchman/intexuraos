/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromptCard } from '../PromptCard.js';

afterEach(() => {
  cleanup();
});

function renderPromptCard(overrides: Partial<React.ComponentProps<typeof PromptCard>> = {}): {
  onPromptChange: ReturnType<typeof vi.fn>;
  onAutoImprove: ReturnType<typeof vi.fn>;
  onPromptBlur: ReturnType<typeof vi.fn>;
} {
  const onPromptChange = vi.fn();
  const onAutoImprove = vi.fn();
  const onPromptBlur = vi.fn();
  render(
    <PromptCard
      prompt=""
      onPromptChange={onPromptChange}
      onPromptBlur={onPromptBlur}
      onAutoImprove={onAutoImprove}
      improving={false}
      submitting={false}
      savingDraft={false}
      {...overrides}
    />,
  );
  return { onPromptChange, onAutoImprove, onPromptBlur };
}

describe('PromptCard', () => {
  it('shows current prompt length and 20000-char budget', () => {
    renderPromptCard({ prompt: 'hello world' });
    expect(screen.getByText('11/20000 characters')).toBeTruthy();
  });

  it('enables Auto Improve for a non-empty prompt through the platform model', () => {
    renderPromptCard({ prompt: 'a real prompt with content' });
    const button = screen.getByRole('button', { name: /Auto Improve/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('invokes onAutoImprove when prompt is non-empty and key available', () => {
    const { onAutoImprove } = renderPromptCard({ prompt: 'a real prompt' });
    fireEvent.click(screen.getByRole('button', { name: /Auto Improve/i }));
    expect(onAutoImprove).toHaveBeenCalledTimes(1);
  });
});

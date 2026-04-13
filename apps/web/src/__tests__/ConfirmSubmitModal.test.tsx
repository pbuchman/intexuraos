/**
 * Tests for ConfirmSubmitModal - task mode display.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfirmSubmitModal } from '../components/ConfirmSubmitModal.js';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Send: (): React.JSX.Element => <span data-testid="icon-send" />,
  Loader2: (): React.JSX.Element => <span data-testid="icon-loader" />,
}));

// Mock Button component
vi.mock('../components/ui/Button.js', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }): React.JSX.Element => (
    <button onClick={onClick} disabled={disabled === true} type="button">
      {children}
    </button>
  ),
}));

// Mock workers/shared
vi.mock('../components/workers/shared.js', () => ({
  WORKER_TYPE_LABELS: {
    auto: 'Auto',
    opus: 'Opus',
    sonnet: 'Sonnet',
    minimax: 'MiniMax',
    glm: 'GLM',
    qwen: 'Qwen',
    kimi: 'Kimi',
    codex: 'Codex',
    'codex-xhigh': 'Codex XHigh',
    'openrouter-free': 'OpenRouter Free',
  } as Record<string, string>,
}));

describe('ConfirmSubmitModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('displays task mode in confirmation text', () => {
    render(
      <ConfirmSubmitModal
        isOpen={true}
        taskTitle="Test task"
        workerType="auto"
        taskMode="execution"
        onConfirm={async (): Promise<void> => {}}
        onCancel={(): void => {}}
      />
    );
    expect(screen.getByText('Execution')).toBeInTheDocument();
    expect(screen.getByText(/mode\?/)).toBeInTheDocument();
  });

  it('displays Planning mode label', () => {
    render(
      <ConfirmSubmitModal
        isOpen={true}
        taskTitle="Design feature"
        workerType="auto"
        taskMode="planning"
        onConfirm={async (): Promise<void> => {}}
        onCancel={(): void => {}}
      />
    );
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ConfirmSubmitModal
        isOpen={false}
        taskTitle="Test task"
        workerType="auto"
        taskMode="execution"
        onConfirm={async (): Promise<void> => {}}
        onCancel={(): void => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

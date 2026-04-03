/**
 * Tests for CodeTaskNewPage - linearMode reset behavior on modal cancel.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CodeTaskNewPage } from '../pages/CodeTaskNewPage.js';
import type { LinearIssueOption } from '../hooks/useLinearIssueOptions.js';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: (): typeof mockNavigate => mockNavigate,
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }): React.JSX.Element => <a href={to}>{children}</a>,
}));

// Mock @/context
vi.mock('@/context', () => ({
  useAuth: (): {
    getAccessToken: () => Promise<string>;
    isAuthenticated: boolean;
    user: null;
  } => ({
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
    isAuthenticated: true,
    user: null,
  }),
}));

// Mock @/services/codeAgentApi (imported directly in CodeTaskNewPage for timeout recovery)
vi.mock('@/services/codeAgentApi', () => ({
  listCodeTasks: vi.fn(),
  submitCodeTask: vi.fn().mockResolvedValue({ status: 'submitted', codeTaskId: 'task-123' }),
}));

// Mock @/services/apiClient
vi.mock('@/services/apiClient', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  parseConflictError: vi.fn(),
}));

// Mock @/hooks
vi.mock('@/hooks', () => ({
  useLinearIssueOptions: (): {
    groupedOptions: Record<string, LinearIssueOption[]>;
    loading: boolean;
    error: null;
  } => ({
    groupedOptions: {},
    loading: false,
    error: null,
  }),
  useWorkersStatus: (): {
    status: { workers: { name: string; priority: number; healthy: boolean }[] };
    loading: boolean;
  } => ({
    status: {
      workers: [{ name: 'worker-1', priority: 1, healthy: true }],
    },
    loading: false,
  }),
  findRecentTask: vi.fn(),
}));

// Mock @uiw/react-md-editor
vi.mock('@uiw/react-md-editor', () => ({
  default: ({
    value,
    onChange,
    textareaProps,
  }: {
    value: string;
    onChange: (v: string | undefined) => void;
    textareaProps?: { placeholder?: string; disabled?: boolean };
  }): React.JSX.Element => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(e): void => {
        onChange(e.target.value);
      }}
      placeholder={textareaProps?.placeholder}
      disabled={textareaProps?.disabled}
    />
  ),
}));

// Mock rehype-sanitize
vi.mock('rehype-sanitize', () => ({
  default: (): null => null,
}));

// Mock lucide-react icons used in CodeTaskNewPage
vi.mock('lucide-react', () => ({
  AlertCircle: (): React.JSX.Element => <span data-testid="icon-alert-circle" />,
  Play: (): React.JSX.Element => <span data-testid="icon-play" />,
  Link2: (): React.JSX.Element => <span data-testid="icon-link2" />,
  Sparkles: (): React.JSX.Element => <span data-testid="icon-sparkles" />,
  Pencil: (): React.JSX.Element => <span data-testid="icon-pencil" />,
}));

/** Dummy issue to use when simulating a selection in the modal */
const DUMMY_ISSUE: LinearIssueOption = {
  identifier: 'INT-123',
  title: 'Test Issue',
  url: 'https://linear.app/test/issue/INT-123',
  priority: 0,
  parentId: null,
};

// Mock @/components — LinearIssueSelectorModal renders controls to simulate cancel/select
vi.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    loadingText,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    loadingText?: string;
  }): React.JSX.Element => (
    <button onClick={onClick} disabled={disabled === true || isLoading === true} type="button">
      {isLoading === true && loadingText !== undefined ? loadingText : children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div data-testid="card">{children}</div>
  ),
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div data-testid="layout">{children}</div>
  ),
  ConfirmSubmitModal: (): null => null,
  TaskConflictModal: (): null => null,
  TaskErrorModal: (): null => null,
  LinearIssueSelectorModal: ({
    isOpen,
    onClose,
    onSelect,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (option: LinearIssueOption) => void;
    selected: LinearIssueOption | null;
    groupedOptions: Record<string, LinearIssueOption[]>;
    loading: boolean;
    error: string | null;
  }): React.JSX.Element | null => {
    if (!isOpen) return null;
    return (
      <div data-testid="issue-selector-modal">
        <button type="button" onClick={onClose} data-testid="modal-cancel-btn">
          Cancel
        </button>
        <button
          type="button"
          onClick={(): void => {
            onSelect(DUMMY_ISSUE);
          }}
          data-testid="modal-select-btn"
        >
          Select Issue
        </button>
      </div>
    );
  },
}));

describe('CodeTaskNewPage - linearMode reset behavior', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const getLinkExistingButton = (): HTMLElement =>
    screen.getByRole('button', { name: /link existing/i });
  const getCreateNewButton = (): HTMLElement =>
    screen.getByRole('button', { name: /create new/i });

  it('should reset linearMode to create when modal cancelled without selection', () => {
    render(<CodeTaskNewPage />);

    // Initially, "Create New" is active (border-blue-500)
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');

    // Click "Link Existing" to switch mode and open the modal
    fireEvent.click(getLinkExistingButton());

    // Modal is open and "Link Existing" is now the active mode
    expect(screen.getByTestId('issue-selector-modal')).toBeInTheDocument();
    expect(getLinkExistingButton().className).toContain('border-blue-500');
    expect(getCreateNewButton().className).not.toContain('border-blue-500');

    // Cancel the modal without selecting an issue
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    // Modal should be closed
    expect(screen.queryByTestId('issue-selector-modal')).not.toBeInTheDocument();

    // linearMode should have reset to 'create' because no issue was selected
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');
  });

  it('should keep linearMode as link when issue is selected before modal closes', () => {
    render(<CodeTaskNewPage />);

    // Click "Link Existing"
    fireEvent.click(getLinkExistingButton());
    expect(screen.getByTestId('issue-selector-modal')).toBeInTheDocument();

    // Select an issue in the modal (onSelect closes the modal automatically)
    fireEvent.click(screen.getByTestId('modal-select-btn'));

    // Modal is closed
    expect(screen.queryByTestId('issue-selector-modal')).not.toBeInTheDocument();

    // linearMode stays 'link' because an issue was selected
    expect(getLinkExistingButton().className).toContain('border-blue-500');
    expect(getCreateNewButton().className).not.toContain('border-blue-500');
  });

  it('should retain linearMode as link and keep selected issue when reopened via pencil then cancelled', () => {
    render(<CodeTaskNewPage />);

    // Click "Link Existing" and select an issue
    fireEvent.click(getLinkExistingButton());
    fireEvent.click(screen.getByTestId('modal-select-btn'));

    // Issue is now selected: identifier shown, pencil button visible
    expect(screen.queryByTestId('issue-selector-modal')).not.toBeInTheDocument();
    expect(screen.getByText('INT-123')).toBeInTheDocument();
    expect(getLinkExistingButton().className).toContain('border-blue-500');

    // Reopen the modal via the pencil (change issue) button
    fireEvent.click(screen.getByTitle('Change issue'));
    expect(screen.getByTestId('issue-selector-modal')).toBeInTheDocument();

    // Cancel without selecting a different issue
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    // Modal closed; linearMode remains 'link' because selectedIssue was not null
    expect(screen.queryByTestId('issue-selector-modal')).not.toBeInTheDocument();
    expect(getLinkExistingButton().className).toContain('border-blue-500');
    expect(getCreateNewButton().className).not.toContain('border-blue-500');
    // Previously selected issue is still shown
    expect(screen.getByText('INT-123')).toBeInTheDocument();
  });

  it('should stay in create mode when Create New is clicked after a cancelled Link Existing', () => {
    render(<CodeTaskNewPage />);

    // Click "Link Existing" and cancel the modal
    fireEvent.click(getLinkExistingButton());
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    // After cancel, "Create New" should be active (mode reset)
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');

    // Clicking "Create New" again retains 'create' mode
    fireEvent.click(getCreateNewButton());
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');
  });

  it('shows updated worker descriptions', () => {
    render(<CodeTaskNewPage />);

    expect(screen.getByText('Automatically select the best available model for the task')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Opus' }));
    expect(screen.getByText('Anthropic\'s most capable model for complex reasoning and coding tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sonnet' }));
    expect(screen.getByText('Anthropic\'s daily coding model with the best balance of speed and intelligence')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax' }));
    expect(screen.getByText('MiniMax\'s coding and agent model with strong reasoning at lower cost')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'GLM' }));
    expect(screen.getByText('Zhipu\'s flagship Agentic Engineering model for complex systems and long-running agent tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Qwen' }));
    expect(screen.getByText('Advanced Qwen model with thinking enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kimi' }));
    expect(screen.getByText('Moonshot\'s latest recommended model with image understanding')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText('OpenAI Codex runtime for code-task execution with persisted thread resume')).toBeInTheDocument();
  });

  it('uses worker-neutral copy on the task creation page', () => {
    render(<CodeTaskNewPage />);

    expect(screen.getByText('Submit a coding task to be executed by the selected worker')).toBeInTheDocument();
    const editors = screen.getAllByTestId('md-editor');
    expect(editors).toHaveLength(2);
    for (const editor of editors) {
      expect(editor).toHaveAttribute(
        'placeholder',
        'Describe what you want to build. The selected worker will analyze the instructions, create a Linear issue with acceptance criteria, and prepare a design — no code will be written prior to your approval.'
      );
    }
  });
});

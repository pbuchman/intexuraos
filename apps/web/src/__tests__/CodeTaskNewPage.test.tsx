/**
 * Tests for CodeTaskNewPage - linearMode reset behavior on modal cancel.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CodeTaskNewPage } from '../pages/CodeTaskNewPage.js';
import type { LinearIssueOption } from '../hooks/useLinearIssueOptions.js';
import { submitCodeTask } from '../services/codeAgentApi.js';
import type { WorkerSettingsResponse } from '../services/workerSettingsApi.types.js';

const mockWorkerSettings = vi.hoisted((): { current: WorkerSettingsResponse | null } => ({
  current: null,
}));

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
    status: { workers: { name: string; priority: number; enabled: boolean; healthy: boolean }[] };
    loading: boolean;
  } => ({
    status: {
      workers: [{ name: 'worker-1', priority: 1, enabled: true, healthy: true }],
    },
    loading: false,
  }),
  findRecentTask: vi.fn(),
  useTimeTick: (): number => 0,
}));

vi.mock('@/hooks/useWorkerSettings', () => ({
  useWorkerSettings: (): {
    settings: WorkerSettingsResponse | null;
    loading: boolean;
    refreshing: boolean;
    error: null;
    addWorker: () => Promise<void>;
    updateWorker: () => Promise<void>;
    deleteWorker: () => Promise<void>;
    testConnectivity: () => Promise<never>;
    reorderWorkers: () => Promise<void>;
    updateDefaultWorkerType: () => Promise<void>;
    refresh: () => Promise<void>;
  } => ({
    settings: mockWorkerSettings.current,
    loading: false,
    refreshing: false,
    error: null,
    addWorker: vi.fn().mockResolvedValue(undefined),
    updateWorker: vi.fn().mockResolvedValue(undefined),
    deleteWorker: vi.fn().mockResolvedValue(undefined),
    testConnectivity: vi.fn().mockRejectedValue(new Error('not implemented')),
    reorderWorkers: vi.fn().mockResolvedValue(undefined),
    updateDefaultWorkerType: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
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
  ClipboardList: (): React.JSX.Element => <span data-testid="icon-clipboard-list" />,
  Rocket: (): React.JSX.Element => <span data-testid="icon-rocket" />,
  Clock: (): React.JSX.Element => <span data-testid="icon-clock" />,
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
  ConfirmSubmitModal: ({
    isOpen,
    onConfirm,
    onCancel,
    schedule,
  }: {
    isOpen: boolean;
    taskTitle: string;
    workerType: string;
    taskMode: string;
    schedule?: { localDateTime: string; timezone: string; notBeforeAt: string };
    onConfirm: () => Promise<void>;
    onCancel: () => void;
  }): React.JSX.Element | null => {
    if (!isOpen) return null;
    return (
      <div data-testid="confirm-submit-modal">
        {schedule !== undefined ? (
          <div data-testid="confirm-schedule">
            {schedule.notBeforeAt} {schedule.timezone}
          </div>
        ) : null}
        <button
          type="button"
          data-testid="confirm-submit-btn"
          onClick={(): void => {
            void onConfirm();
          }}
        >
          Confirm Submit
        </button>
        <button
          type="button"
          data-testid="confirm-cancel-btn"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    );
  },
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
    mockWorkerSettings.current = null;
  });

  const getLinkExistingButton = (): HTMLElement =>
    screen.getByRole('button', { name: /link existing/i });
  const getCreateNewButton = (): HTMLElement =>
    screen.getByRole('button', { name: /create new/i });

  it('should reset linearMode to create when modal cancelled without selection', () => {
    render(<CodeTaskNewPage />);

    // Initially, "Create new" is active (border-blue-500)
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');

    // Click "Link existing" to switch mode and open the modal
    fireEvent.click(getLinkExistingButton());

    // Modal is open and "Link existing" is now the active mode
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

    // Click "Link existing"
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

    // Click "Link existing" and select an issue
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

  it('should stay in create mode when Create new is clicked after a cancelled Link existing', () => {
    render(<CodeTaskNewPage />);

    // Click "Link existing" and cancel the modal
    fireEvent.click(getLinkExistingButton());
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    // After cancel, "Create new" should be active (mode reset)
    expect(getCreateNewButton().className).toContain('border-blue-500');
    expect(getLinkExistingButton().className).not.toContain('border-blue-500');

    // Clicking "Create new" again retains 'create' mode
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

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText('OpenAI Codex runtime for code-task execution with persisted thread resume')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Codex XHigh' }));
    expect(screen.getByText('High-effort Codex preset for deeper reviews, investigations, and complex implementation tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'OpenRouter Free' }));
    expect(screen.getByText('Free-tier code worker routed only through OpenRouter')).toBeInTheDocument();
  });

  it('renders task mode selector with Planning and Execution options', () => {
    render(<CodeTaskNewPage />);

    expect(screen.getByRole('button', { name: /planning/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execution/i })).toBeInTheDocument();
  });

  it('defaults to Planning mode when linear mode is Create new', () => {
    render(<CodeTaskNewPage />);

    const planningButton = screen.getByRole('button', { name: /planning/i });
    const executionButton = screen.getByRole('button', { name: /execution/i });

    expect(planningButton.className).toContain('border-blue-500');
    expect(executionButton.className).not.toContain('border-blue-500');
  });

  it('switches to Execution mode when linking an existing issue', () => {
    render(<CodeTaskNewPage />);

    fireEvent.click(getLinkExistingButton());

    const planningButton = screen.getByRole('button', { name: /planning/i });
    const executionButton = screen.getByRole('button', { name: /execution/i });

    expect(executionButton.className).toContain('border-blue-500');
    expect(planningButton.className).not.toContain('border-blue-500');
  });

  it('allows user to override task mode back to Planning after linking issue', () => {
    render(<CodeTaskNewPage />);

    // Switch to Link existing (sets taskMode to execution)
    fireEvent.click(getLinkExistingButton());

    const planningButton = screen.getByRole('button', { name: /planning/i });
    const executionButton = screen.getByRole('button', { name: /execution/i });

    expect(executionButton.className).toContain('border-blue-500');

    // Override back to Planning
    fireEvent.click(planningButton);

    expect(planningButton.className).toContain('border-blue-500');
    expect(executionButton.className).not.toContain('border-blue-500');
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

describe('CodeTaskNewPage - default worker selection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockWorkerSettings.current = null;
  });

  const configureWorkerSettings = (
    settings: Partial<Pick<WorkerSettingsResponse, 'defaultExecutionWorkerType' | 'defaultPlanningWorkerType'>>,
  ): void => {
    mockWorkerSettings.current = {
      workers: [],
      ...settings,
    };
  };

  it('selects the saved planning default on initial load', async () => {
    configureWorkerSettings({ defaultPlanningWorkerType: 'opus' });

    render(<CodeTaskNewPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Opus' }).className).toContain('border-blue-500');
    });
    expect(screen.getByRole('button', { name: 'Auto' }).className).not.toContain('border-blue-500');
  });

  it('selects the execution default when switching from planning to execution', async () => {
    configureWorkerSettings({
      defaultPlanningWorkerType: 'opus',
      defaultExecutionWorkerType: 'codex',
    });

    render(<CodeTaskNewPage />);

    fireEvent.click(screen.getByRole('button', { name: /execution/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Codex' }).className).toContain('border-blue-500');
    });
    expect(screen.getByRole('button', { name: 'Opus' }).className).not.toContain('border-blue-500');
  });

  it('returns to the planning default when switching back from execution', async () => {
    configureWorkerSettings({
      defaultPlanningWorkerType: 'opus',
      defaultExecutionWorkerType: 'codex',
    });

    render(<CodeTaskNewPage />);

    fireEvent.click(screen.getByRole('button', { name: /execution/i }));
    fireEvent.click(screen.getByRole('button', { name: /planning/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Opus' }).className).toContain('border-blue-500');
    });
    expect(screen.getByRole('button', { name: 'Codex' }).className).not.toContain('border-blue-500');
  });

  it('submits the selected default worker type in the request', async () => {
    configureWorkerSettings({ defaultPlanningWorkerType: 'opus' });

    render(<CodeTaskNewPage />);

    const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'default worker task' } });

    const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
    fireEvent.click(submitButtons[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('confirm-submit-btn'));

    await waitFor(() => {
      expect(submitCodeTask).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(submitCodeTask).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload['workerType']).toBe('opus');
  });

  it('keeps a manual worker selection when worker settings refresh for the current mode', async () => {
    configureWorkerSettings({ defaultPlanningWorkerType: 'opus' });

    const { rerender } = render(<CodeTaskNewPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Opus' }).className).toContain('border-blue-500');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sonnet' }));
    expect(screen.getByRole('button', { name: 'Sonnet' }).className).toContain('border-blue-500');

    configureWorkerSettings({ defaultPlanningWorkerType: 'codex' });
    rerender(<CodeTaskNewPage />);

    expect(screen.getByRole('button', { name: 'Sonnet' }).className).toContain('border-blue-500');

    const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'manual worker task' } });

    const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
    fireEvent.click(submitButtons[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('confirm-submit-btn'));

    await waitFor(() => {
      expect(submitCodeTask).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(submitCodeTask).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload['workerType']).toBe('sonnet');
  });
});

describe('CodeTaskNewPage - scheduled dispatch UX', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const enableExecutionMode = (): void => {
    fireEvent.click(screen.getByRole('button', { name: /execution/i }));
  };

  it('hides the schedule toggle in planning mode (default)', () => {
    render(<CodeTaskNewPage />);

    expect(
      screen.queryByText(/schedule this execution/i),
    ).not.toBeInTheDocument();
  });

  it('reveals "Schedule this execution" when execution mode is selected', () => {
    render(<CodeTaskNewPage />);

    enableExecutionMode();

    expect(
      screen.getByText(/schedule this execution/i),
    ).toBeInTheDocument();
  });

  it('renders timezone label, datetime-local input, and helper copy when schedule is enabled', () => {
    render(<CodeTaskNewPage />);
    enableExecutionMode();

    const checkbox = screen.getByRole('checkbox', { name: /schedule this execution/i });
    fireEvent.click(checkbox);

    expect(screen.getByText(/your timezone:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scheduled dispatch time/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /the task joins the queue immediately, but will not dispatch before the selected time\./i,
      ),
    ).toBeInTheDocument();
  });

  it('shows inline "Must be in the future" error when a past datetime is selected', () => {
    render(<CodeTaskNewPage />);
    enableExecutionMode();
    fireEvent.click(screen.getByRole('checkbox', { name: /schedule this execution/i }));

    const input = screen.getByLabelText(/scheduled dispatch time/i) as HTMLInputElement;
    // Past time relative to any reasonable test clock.
    fireEvent.change(input, { target: { value: '2000-01-01T00:00' } });

    expect(screen.getByText(/must be in the future/i)).toBeInTheDocument();
  });

  it('shows live preview starting with "Dispatches" when a future datetime is selected', () => {
    render(<CodeTaskNewPage />);
    enableExecutionMode();
    fireEvent.click(screen.getByRole('checkbox', { name: /schedule this execution/i }));

    const input = screen.getByLabelText(/scheduled dispatch time/i) as HTMLInputElement;
    // Far future: 2999-01-01 00:00 local.
    fireEvent.change(input, { target: { value: '2999-01-01T00:00' } });

    expect(screen.queryByText(/must be in the future/i)).not.toBeInTheDocument();
    const preview = screen.getByText(/^Dispatches /);
    expect(preview).toBeInTheDocument();
  });

  it('clears schedule state and hides the control when switching back to planning mode', () => {
    render(<CodeTaskNewPage />);
    enableExecutionMode();
    fireEvent.click(screen.getByRole('checkbox', { name: /schedule this execution/i }));

    const input = screen.getByLabelText(/scheduled dispatch time/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2999-01-01T00:00' } });

    // Switch to planning
    fireEvent.click(screen.getByRole('button', { name: /planning/i }));

    // Control is hidden.
    expect(
      screen.queryByText(/schedule this execution/i),
    ).not.toBeInTheDocument();

    // Re-enable execution mode: schedule should be collapsed again (state cleared).
    enableExecutionMode();
    const checkbox = screen.getByRole('checkbox', { name: /schedule this execution/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByLabelText(/scheduled dispatch time/i)).not.toBeInTheDocument();
  });

  it('submits request with scheduledDispatch when execution mode + future schedule are set', async () => {
    // Stub the browser timezone so we can assert it.
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/New_York',
    } as Intl.ResolvedDateTimeFormatOptions);

    try {
      render(<CodeTaskNewPage />);

      // Provide prompt so form is valid.
      const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
      fireEvent.change(editor, { target: { value: 'do the thing' } });

      enableExecutionMode();
      fireEvent.click(screen.getByRole('checkbox', { name: /schedule this execution/i }));

      const futureLocal = '2999-01-01T00:00';
      const input = screen.getByLabelText(/scheduled dispatch time/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: futureLocal } });

      // Open confirm modal.
      const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
      fireEvent.click(submitButtons[0] as HTMLElement);

      // Click the confirm button inside the modal.
      fireEvent.click(screen.getByTestId('confirm-submit-btn'));

      await waitFor(() => {
        expect(submitCodeTask).toHaveBeenCalledTimes(1);
      });

      const call = vi.mocked(submitCodeTask).mock.calls[0];
      expect(call).toBeDefined();
      const [, requestBody] = call as [string, { scheduledDispatch?: { timezone: string; notBeforeAt: string; localDateTime: string } }];
      expect(requestBody.scheduledDispatch).toBeDefined();
      const sd = requestBody.scheduledDispatch;
      if (sd === undefined) throw new Error('scheduledDispatch missing');
      expect(sd.timezone).toBe('America/New_York');
      expect(sd.localDateTime).toBe(futureLocal);
      // notBeforeAt should be a valid ISO UTC string in the future.
      const nb = new Date(sd.notBeforeAt);
      expect(Number.isNaN(nb.getTime())).toBe(false);
      expect(nb.getTime() > Date.now()).toBe(true);
      expect(sd.notBeforeAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
    }
  });
});

describe('CodeTaskNewPage - per-task timeout (INT-1585)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('omits timeoutHours from the request when slider stays at the default (5h)', async () => {
    render(<CodeTaskNewPage />);

    const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'default-timeout task' } });

    // Do NOT touch the slider — it stays at DEFAULT_TIMEOUT_HOURS (5).

    const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
    fireEvent.click(submitButtons[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('confirm-submit-btn'));

    await waitFor(() => {
      expect(submitCodeTask).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(submitCodeTask).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload['timeoutHours']).toBeUndefined();
  });

  it('sends timeoutHours when the slider is changed to a non-default value', async () => {
    render(<CodeTaskNewPage />);

    const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'long task' } });

    // Set the slider to 8 hours.
    const slider = screen.getByRole('slider', { name: /task timeout/i });
    fireEvent.change(slider, { target: { value: '8' } });

    const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
    fireEvent.click(submitButtons[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('confirm-submit-btn'));

    await waitFor(() => {
      expect(submitCodeTask).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(submitCodeTask).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload['timeoutHours']).toBe(8);
  });
});

describe('CodeTaskNewPage - immediate failed task responses', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('navigates to the task page when submit returns a failed task id', async () => {
    vi.mocked(submitCodeTask).mockResolvedValueOnce({
      status: 'failed',
      codeTaskId: 'task-failed-123',
    } as never);
    render(<CodeTaskNewPage />);

    const editor = screen.getAllByTestId('md-editor')[0] as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'task that cannot dispatch' } });

    const submitButtons = screen.getAllByRole('button', { name: /submit task/i });
    fireEvent.click(submitButtons[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('confirm-submit-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/code-tasks/task-failed-123');
    });
  });
});

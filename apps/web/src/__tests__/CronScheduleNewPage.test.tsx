import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { CronScheduleNewPage } from '../pages/cron-agent/CronScheduleNewPage.js';
import type { ServiceInfo } from '../types/cronAgent.js';

const mockNavigate = vi.fn();
const mockCreateSchedule = vi.fn();

const services: ServiceInfo[] = [
  {
    key: 'code-agent',
    name: 'Code Agent',
    tools: [
      {
        name: 'code_agent__cleanupTaskLogs',
        description: 'Cleanup task logs',
        parameters: {
          type: 'object',
          properties: {
            body: {
              type: 'object',
              properties: {
                retentionDays: { type: 'number' },
                dryRun: { type: 'boolean' },
              },
            },
          },
        },
      },
    ],
  },
];

vi.mock('react-router-dom', () => ({
  useNavigate: (): typeof mockNavigate => mockNavigate,
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    getAccessToken: () => Promise<string>;
  } => ({
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
  }),
}));

vi.mock('@/hooks', () => ({
  useCronServices: (): {
    services: ServiceInfo[];
    loading: boolean;
    error: null;
  } => ({
    services,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/services/cronAgentApi', () => ({
  createSchedule: (...args: unknown[]): Promise<unknown> => mockCreateSchedule(...args),
}));

vi.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    loadingText?: string;
    variant?: string;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick} disabled={disabled === true || isLoading === true}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
}));

describe('CronScheduleNewPage', () => {
  beforeEach(() => {
    mockCreateSchedule.mockResolvedValue({ id: 'schedule-123' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('injects clicked tool templates into the instruction and sends preferredTools', async () => {
    render(<CronScheduleNewPage />);

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Code Cleanup' },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'every 15 minutes' },
    });

    fireEvent.click(screen.getByRole('button', { name: /code agent/i }));
    fireEvent.click(screen.getByRole('button', { name: /available tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /code_agent__cleanupTaskLogs/i }));

    const instruction = screen.getByLabelText(/instruction/i) as HTMLTextAreaElement;
    expect(instruction.value).toContain('Preferred tool: code_agent__cleanupTaskLogs');
    expect(instruction.value).toContain('"retentionDays": 0');
    expect(instruction.value).toContain('"dryRun": false');

    fireEvent.click(screen.getByRole('button', { name: /create schedule/i }));

    await waitFor(() => {
      expect(mockCreateSchedule).toHaveBeenCalledWith('test-token', {
        name: 'Code Cleanup',
        description: 'every 15 minutes',
        action: {
          services: ['code-agent'],
          instruction: expect.stringContaining('Preferred tool: code_agent__cleanupTaskLogs'),
          preferredTools: ['code_agent__cleanupTaskLogs'],
        },
        timezone: 'UTC',
      });
    });
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseWorkerSettings, mockDefaultWorkerTypeCard, mockWorkerRow } = vi.hoisted(() => ({
  mockUseWorkerSettings: vi.fn(),
  mockDefaultWorkerTypeCard: vi.fn(),
  mockWorkerRow: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useWorkerSettings: (): ReturnType<typeof mockUseWorkerSettings> => mockUseWorkerSettings(),
  useTimezone: (): {
    timezone: string;
    loading: boolean;
    error: null;
    updateTimezone: ReturnType<typeof vi.fn>;
  } => ({
    timezone: 'Europe/Berlin',
    loading: false,
    error: null,
    updateTimezone: vi.fn(),
  }),
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock('@/components/workers/WorkerRow.js', () => ({
  WorkerRow: (props: unknown): null => {
    mockWorkerRow(props);
    return null;
  },
}));

vi.mock('@/components/workers/AddWorkerForm.js', () => ({
  AddWorkerForm: (): null => null,
}));

vi.mock('@/components/workers/DefaultWorkerTypeCard.js', () => ({
  DefaultWorkerTypeCard: (props: {
    title: string;
    currentType: string;
  }): React.JSX.Element => {
    mockDefaultWorkerTypeCard(props);
    return <div>{props.title}</div>;
  },
}));

import { WorkerSettingsPage } from '../WorkerSettingsPage.js';

describe('WorkerSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkerSettings.mockReturnValue({
      settings: { workers: [] },
      loading: false,
      error: null,
      addWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      testConnectivity: vi.fn(),
      reorderWorkers: vi.fn(),
      updateDefaultWorkerType: vi.fn(),
    });
  });

  it('shows auto as the selected review worker type when no default is saved', () => {
    renderToStaticMarkup(<WorkerSettingsPage />);

    expect(mockDefaultWorkerTypeCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Default Review Model',
        currentType: 'auto',
      })
    );
  });

  it('shows the saved Sentry worker type setting', () => {
    mockUseWorkerSettings.mockReturnValue({
      settings: { workers: [], defaultSentryWorkerType: 'codex-xhigh' },
      loading: false,
      error: null,
      addWorker: vi.fn(),
      updateWorker: vi.fn(),
      deleteWorker: vi.fn(),
      testConnectivity: vi.fn(),
      reorderWorkers: vi.fn(),
      updateDefaultWorkerType: vi.fn(),
    });

    renderToStaticMarkup(<WorkerSettingsPage />);

    expect(mockDefaultWorkerTypeCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Default Sentry Model',
        currentType: 'codex-xhigh',
      })
    );
  });

  it('passes worker enabled updates through Code Settings row handlers', async () => {
    const updateWorker = vi.fn().mockResolvedValue(undefined);
    mockUseWorkerSettings.mockReturnValue({
      settings: {
        workers: [{
          name: 'mac',
          url: 'https://mac.example.com',
          cfAccessClientId: 'masked-id',
          cfAccessClientSecret: 'masked-secret',
          dispatchSigningSecret: 'masked-signing',
          enabled: true,
        }],
      },
      loading: false,
      error: null,
      addWorker: vi.fn(),
      updateWorker,
      deleteWorker: vi.fn(),
      testConnectivity: vi.fn(),
      reorderWorkers: vi.fn(),
      updateDefaultWorkerType: vi.fn(),
    });

    renderToStaticMarkup(<WorkerSettingsPage />);

    const rowProps = mockWorkerRow.mock.calls[0]?.[0] as {
      worker: { enabled: boolean };
      onUpdate: (config: { enabled: boolean }) => Promise<void>;
    };
    expect(rowProps.worker.enabled).toBe(true);

    await rowProps.onUpdate({ enabled: false });

    expect(updateWorker).toHaveBeenCalledWith('mac', { enabled: false });
  });
});

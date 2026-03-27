import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseWorkerSettings, mockDefaultWorkerTypeCard } = vi.hoisted(() => ({
  mockUseWorkerSettings: vi.fn(),
  mockDefaultWorkerTypeCard: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useWorkerSettings: (): ReturnType<typeof mockUseWorkerSettings> => mockUseWorkerSettings(),
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => (
    <button {...props}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock('@/components/workers/WorkerRow.js', () => ({
  WorkerRow: (): null => null,
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
});

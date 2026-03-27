import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { mockUseWorkerSettings } = vi.hoisted(() => ({
  mockUseWorkerSettings: vi.fn(),
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
    const markup = renderToStaticMarkup(<WorkerSettingsPage />);

    expect(markup).toMatch(
      /<button[^>]*border-blue-500 bg-blue-50 text-blue-700[^>]*>\s*Auto\s*<\/button>/
    );
    expect(markup).toMatch(
      /<button[^>]*border-slate-200 bg-white text-slate-700 hover:bg-slate-50[^>]*>\s*GLM\s*<\/button>/
    );
  });
});

/**
 * Tests for Header component.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Header } from '../Header.js';

// Mock useAuth context
const mockGetAccessToken = vi.fn();
const mockIsAuthenticated = true;
const mockUser = { sub: 'user-123', name: 'Test User' };

vi.mock('@/context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: typeof mockUser;
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
    user: mockUser,
  }),
  useSyncQueue: (): {
    pendingCount: number;
    isSyncing: boolean;
    isOnline: boolean;
    authFailed: boolean;
  } => ({
    pendingCount: 0,
    isSyncing: false,
    isOnline: true,
    authFailed: false,
  }),
  useTheme: (): {
    resolvedTheme: 'light' | 'dark';
    toggleTheme: () => void;
  } => ({
    resolvedTheme: 'light' as const,
    toggleTheme: vi.fn(),
  }),
}));

// Mock usePWA - will be overridden in tests
const mockUsePWA = vi.fn();
vi.mock('@/context/pwa-context.js', () => ({
  usePWA: (): unknown => mockUsePWA(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Link: ({
      children,
      to,
      onClick,
      className,
      title,
    }: {
      children: React.ReactNode;
      to: string;
      onClick?: () => void;
      className?: string;
      title?: string;
    }): React.JSX.Element => (
      <a href={to} onClick={onClick} className={className} title={title}>
        {children}
      </a>
    ),
  };
});

// Mock useWorkersStatus - will be overridden in tests
const mockUseWorkersStatus = vi.fn();
vi.mock('@/hooks/index.js', async () => {
  const actual = await vi.importActual('@/hooks/index.js');
  return {
    ...(actual as object),
    useWorkersStatus: () => mockUseWorkersStatus(),
  } as Record<string, unknown>;
});

// Mock lucide-react icons
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react');
  return {
    ...actual,
    ChevronDown: (): React.JSX.Element => <div data-testid="chevron-down" />,
    LogOut: (): React.JSX.Element => <div data-testid="logout-icon" />,
    Moon: (): React.JSX.Element => <div data-testid="moon-icon" />,
    Sun: (): React.JSX.Element => <div data-testid="sun-icon" />,
    User: (): React.JSX.Element => <div data-testid="user-icon" />,
    RefreshCw: (): React.JSX.Element => <div data-testid="refresh-icon" />,
    RotateCcw: (): React.JSX.Element => <div data-testid="rotate-ccw-icon" />,
    Server: (): React.JSX.Element => <div data-testid="server-icon" />,
  };
});

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    cleanup();
  });

  const defaultPWAValue = {
    isInstalled: false,
    canInstall: false,
    isIOS: false,
    showIOSInstallPrompt: false,
    showAndroidInstallPrompt: false,
    updateAvailable: false,
    dismissIOSInstallPrompt: vi.fn(),
    dismissAndroidInstallPrompt: vi.fn(),
    installApp: vi.fn(),
    applyUpdate: vi.fn(),
  };

  const defaultWorkersStatusValue = {
    status: {
      workers: [
        {
          name: 'mac-worker',
          url: 'https://mac.example.com',
          priority: 1,
          healthy: true,
          checkedAt: '2024-01-01T00:00:00Z',
          status: 'healthy' as const,
          details: null,
          stale: false,
        },
      ],
      stale: false,
    },
    loading: false,
    refreshing: false,
    error: null,
    refresh: vi.fn(),
    refreshStatus: vi.fn(),
  };

  describe('PWA mode', () => {
    it('renders workers status in user menu dropdown (NOT in header bar)', () => {
      // Mock PWA as installed
      mockUsePWA.mockReturnValue({
        ...defaultPWAValue,
        isInstalled: true,
      });

      // Mock workers status with workers
      mockUseWorkersStatus.mockReturnValue(defaultWorkersStatusValue);

      render(<Header />);

      // Verify workers status is NOT in header bar
      expect(screen.queryByTestId('workers-status-header')).not.toBeInTheDocument();

      // Open user menu
      const userMenuButton = screen.getByRole('button', { name: /Test User/i });
      fireEvent.click(userMenuButton);

      // Verify workers status IS in menu
      const workersMenuItem = screen.getByTestId('workers-status-menu');
      expect(workersMenuItem).toBeInTheDocument();
    });

    it('renders workers status in menu even when no workers (shows "No workers configured")', () => {
      // Mock PWA as installed
      mockUsePWA.mockReturnValue({
        ...defaultPWAValue,
        isInstalled: true,
      });

      // Mock workers status with no workers
      mockUseWorkersStatus.mockReturnValue({
        ...defaultWorkersStatusValue,
        status: {
          workers: [],
          stale: false,
        },
      });

      render(<Header />);

      // Open user menu
      const userMenuButton = screen.getByRole('button', { name: /Test User/i });
      fireEvent.click(userMenuButton);

      // Workers menu IS shown even with no workers, but the empty state lives behind the submenu
      expect(screen.getByTestId('workers-status-menu')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Workers' }));
      expect(screen.getByText('No workers configured')).toBeInTheDocument();
    });
  });

  describe('Non-PWA mode (regular web)', () => {
    it('renders workers status in header bar (NOT in user menu)', () => {
      // Mock PWA as NOT installed
      mockUsePWA.mockReturnValue({
        ...defaultPWAValue,
        isInstalled: false,
      });

      // Mock workers status with workers
      mockUseWorkersStatus.mockReturnValue(defaultWorkersStatusValue);

      render(<Header />);

      // Verify workers status IS in header bar
      expect(screen.getByTestId('workers-status-header')).toBeInTheDocument();

      // Open user menu
      const userMenuButton = screen.getByRole('button', { name: /Test User/i });
      fireEvent.click(userMenuButton);

      // Non-PWA keeps the menu item in the DOM for mobile, but hides it at md+.
      expect(screen.getByTestId('workers-status-menu')).toHaveClass('md:hidden');
    });
  });
});

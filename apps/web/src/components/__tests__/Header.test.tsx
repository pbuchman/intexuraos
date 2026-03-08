/**
 * Tests for Header component.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
vi.mock('lucide-react', () => ({
  ChevronDown: (): React.JSX.Element => <div data-testid="chevron-down" />,
  LogOut: (): React.JSX.Element => <div data-testid="logout-icon" />,
  Moon: (): React.JSX.Element => <div data-testid="moon-icon" />,
  Sun: (): React.JSX.Element => <div data-testid="sun-icon" />,
  User: (): React.JSX.Element => <div data-testid="user-icon" />,
  RefreshCw: (): React.JSX.Element => <div data-testid="refresh-icon" />,
  RotateCcw: (): React.JSX.Element => <div data-testid="rotate-ccw-icon" />,
  Server: (): React.JSX.Element => <div data-testid="server-icon" />,
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
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

    it('does not render workers status in menu when no workers', () => {
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

      // Workers status should not be shown when there are no workers
      expect(screen.queryByTestId('workers-status-menu')).not.toBeInTheDocument();
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

      // Verify workers status is NOT in menu (it's in header bar for non-PWA)
      expect(screen.queryByTestId('workers-status-menu')).not.toBeInTheDocument();
    });
  });
});

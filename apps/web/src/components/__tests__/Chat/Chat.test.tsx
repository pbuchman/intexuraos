/**
 * Tests for Chat components.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChatFAB } from '../../Chat/ChatFAB';
import { ChatPanel } from '../../Chat/ChatPanel';
import { ChatMessage } from '../../Chat/ChatMessage';
import { ChatInput } from '../../Chat/ChatInput';
import type { ChatMessage as ChatMessageType } from '../../../types/chat';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  MessageSquare: (): React.JSX.Element => <div data-testid="message-icon" />,
  X: (): React.JSX.Element => <div data-testid="x-icon" />,
  Maximize2: (): React.JSX.Element => <div data-testid="maximize-icon" />,
  Minimize2: (): React.JSX.Element => <div data-testid="minimize-icon" />,
  Send: (): React.JSX.Element => <div data-testid="send-icon" />,
  Copy: (): React.JSX.Element => <div data-testid="copy-icon" />,
  Loader2: (): React.JSX.Element => <div data-testid="loader-icon" />,
  Trash2: (): React.JSX.Element => <div data-testid="trash-icon" />,
}));

// Mock import.meta.env for config
const mockImportMetaEnv = {
  INTEXURAOS_AUTH0_DOMAIN: 'test-domain',
  INTEXURAOS_AUTH0_SPA_CLIENT_ID: 'test-client-id',
  INTEXURAOS_AUTH_AUDIENCE: 'test-audience',
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://localhost:8113',
  INTEXURAOS_NOTION_SERVICE_URL: 'http://localhost:8112',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://localhost:8114',
  INTEXURAOS_RESEARCH_AGENT_URL: 'http://localhost:8116',
  INTEXURAOS_COMMANDS_AGENT_URL: 'http://localhost:8117',
  INTEXURAOS_ACTIONS_AGENT_URL: 'http://localhost:8118',
  INTEXURAOS_NOTES_AGENT_URL: 'http://localhost:8121',
  INTEXURAOS_TODOS_AGENT_URL: 'http://localhost:8123',
  INTEXURAOS_BOOKMARKS_AGENT_URL: 'http://localhost:8124',
  INTEXURAOS_CALENDAR_AGENT_URL: 'http://localhost:8125',
  INTEXURAOS_LINEAR_AGENT_URL: 'http://localhost:8126',
  INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
  INTEXURAOS_CHAT_AGENT_URL: 'http://localhost:8129',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122',
  INTEXURAOS_FIREBASE_PROJECT_ID: 'test-project',
  INTEXURAOS_FIREBASE_API_KEY: 'test-key',
  INTEXURAOS_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  INTEXURAOS_SENTRY_DSN_WEB: 'test-dsn',
};
vi.mock('../../../config.js', () => ({
  config: mockImportMetaEnv,
}));
// @ts-expect-error -- import.meta.env assignment for test environment
Object.assign(import.meta.env, mockImportMetaEnv);

// Mock auth context
const mockGetAccessToken = vi.fn(async () => 'test-token');
const mockIsAuthenticated = true;
vi.mock('../../../context', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: { sub: string };
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
    user: { sub: 'user-123' },
  }),
}));

// Mock chatService
const mockSendMessage = vi.fn();
vi.mock('../../../services/chatService', () => ({
  sendMessage: (...args: unknown[]): unknown => mockSendMessage(...args),
}));

const mockMessages: ChatMessageType[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Hello, how are you?',
    timestamp: Date.now() - 1000,
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'I am doing well, thank you!',
    timestamp: Date.now(),
  },
];

describe('ChatFAB', () => {
  afterEach(() => {
    cleanup();
  });

  it('FAB renders in closed state', () => {
    render(<ChatFAB isOpen={false} onToggle={vi.fn()} />);

    const fab = screen.getByRole('button', { name: /open chat/i });
    expect(fab).toBeInTheDocument();
    expect(fab).toHaveAttribute('aria-label', 'Open chat');
    expect(screen.getByTestId('message-icon')).toBeInTheDocument();
  });

  it('FAB opens panel on click', () => {
    const handleToggle = vi.fn();
    render(<ChatFAB isOpen={false} onToggle={handleToggle} />);

    const fab = screen.getByRole('button', { name: /open chat/i });
    fireEvent.click(fab);

    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it('FAB closes panel on click', () => {
    const handleToggle = vi.fn();
    render(<ChatFAB isOpen={true} onToggle={handleToggle} />);

    const fab = screen.getByRole('button', { name: /close chat/i });
    fireEvent.click(fab);

    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it('FAB stacks above DevBar with correct z-index', () => {
    render(<ChatFAB isOpen={false} onToggle={vi.fn()} />);

    const fab = screen.getByRole('button', { name: /open chat/i });
    expect(fab).toHaveClass('z-[51]');
  });
});

describe('ChatPanel', () => {
  const defaultProps = {
    isOpen: true,
    messages: mockMessages,
    isLoading: false,
    error: null,
    pendingAction: null,
    onSendMessage: vi.fn(),
    onClear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('Panel displays messages', () => {
    render(<ChatPanel {...defaultProps} />);

    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
    expect(screen.getByText('I am doing well, thank you!')).toBeInTheDocument();
  });

  it('Panel shows timestamps', () => {
    render(<ChatPanel {...defaultProps} />);

    // Timestamps are displayed in a format like "10:30 AM"
    // Only one timestamp is shown because messages are 1 second apart (< 5 min gap)
    const timestamps = screen.getAllByTestId(/chat-message-timestamp/);
    expect(timestamps.length).toBe(1);
  });

  it('Panel input accepts text', () => {
    render(<ChatPanel {...defaultProps} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test message' } });

    expect(input).toHaveValue('Test message');
  });

  it('Panel send button triggers API', () => {
    const onSendMessage = vi.fn();

    render(<ChatPanel {...defaultProps} onSendMessage={onSendMessage} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test message' } });

    const sendButton = screen.getByRole('button', { name: /send/i });
    fireEvent.click(sendButton);

    expect(onSendMessage).toHaveBeenCalledWith('Test message');
  });

  it('Panel enter key sends message', () => {
    const onSendMessage = vi.fn();

    render(<ChatPanel {...defaultProps} onSendMessage={onSendMessage} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSendMessage).toHaveBeenCalledWith('Test message');
  });

  it('Panel Shift+Enter creates newline', () => {
    const onSendMessage = vi.fn();

    render(<ChatPanel {...defaultProps} onSendMessage={onSendMessage} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('Panel shows typing indicator when loading', () => {
    render(<ChatPanel {...defaultProps} isLoading={true} />);

    // Two loader icons: typing indicator + disabled send button
    const loaderIcons = screen.getAllByTestId('loader-icon');
    expect(loaderIcons.length).toBe(2);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('Panel hides typing when not loading', () => {
    render(<ChatPanel {...defaultProps} isLoading={false} />);

    expect(screen.queryByTestId('loader-icon')).not.toBeInTheDocument();
  });

  it('Clear button resets state', () => {
    const onClear = vi.fn();

    render(<ChatPanel {...defaultProps} onClear={onClear} />);

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Error displays inline', () => {
    render(<ChatPanel {...defaultProps} error="Something went wrong" />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });
});

describe('ChatMessage', () => {
  const userMessage: ChatMessageType = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
  };

  const assistantMessage: ChatMessageType = {
    id: 'msg-2',
    role: 'assistant',
    content: 'Hi there!',
    timestamp: Date.now(),
  };

  afterEach(() => {
    cleanup();
  });

  it('Message renders markdown', () => {
    render(<ChatMessage message={assistantMessage} isUser={false} />);

    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('Message shows copy button for assistant', () => {
    render(<ChatMessage message={assistantMessage} isUser={false} />);

    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
  });

  it('Copy button copies text to clipboard', async () => {
    const mockWriteText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

    render(<ChatMessage message={assistantMessage} isUser={false} />);

    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith('Hi there!');
  });

  it('User message is right-aligned', () => {
    render(<ChatMessage message={userMessage} isUser={true} />);

    const messageContainer = screen.getByTestId('chat-message-user');
    expect(messageContainer).toHaveClass('justify-end');
  });

  it('Assistant message is left-aligned', () => {
    render(<ChatMessage message={assistantMessage} isUser={false} />);

    const messageContainer = screen.getByTestId('chat-message-assistant');
    expect(messageContainer).toHaveClass('justify-start');
  });
});

describe('ChatInput', () => {
  afterEach(() => {
    cleanup();
  });

  it('input is disabled while loading', () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} />);

    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('send button is disabled when input is empty', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);

    const sendButton = screen.getByRole('button', { name: /send/i });
    expect(sendButton).toBeDisabled();
  });

  it('send button is enabled when input has text', () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test' } });

    const sendButton = screen.getByRole('button', { name: /send/i });
    expect(sendButton).not.toBeDisabled();
  });
});

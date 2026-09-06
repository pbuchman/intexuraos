/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinitionFormProps } from '@/components/message-digests/MessageDigestDefinitionForm';
import type {
  UseMessageDigestCommandsResult,
  UseMessageDigestDefinitionResult,
  UseMessageDigestDeliveryReadinessResult,
} from '@/hooks/useMessageDigests';
import type { CreateMessageDigestInput, MessageDigestDefinition } from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  useMessageDigestCommands: vi.fn(),
  useMessageDigestDefinition: vi.fn(),
  useMessageDigestDeliveryReadiness: vi.fn(),
  captureFormProps: vi.fn(),
  createDigest: vi.fn(),
  updateDigest: vi.fn(),
  clearError: vi.fn(),
  definitionRefresh: vi.fn(),
  definitionRefreshWithResult: vi.fn(),
  definitionAdopt: vi.fn(),
  readinessRefresh: vi.fn(),
  formInput: {
    status: 'active',
    name: 'Daily fishing brief',
    source: { chatId: 'chat-fishing' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize the important fishing facts supported by messages.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
  } as CreateMessageDigestInput,
}));

vi.mock('@/hooks/useMessageDigests', () => ({
  useMessageDigestCommands: (): UseMessageDigestCommandsResult => mocks.useMessageDigestCommands(),
  useMessageDigestDefinition: (definitionId: string): UseMessageDigestDefinitionResult =>
    mocks.useMessageDigestDefinition(definitionId),
  useMessageDigestDeliveryReadiness: (): UseMessageDigestDeliveryReadinessResult =>
    mocks.useMessageDigestDeliveryReadiness(),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

vi.mock('@/components/message-digests/MessageDigestDefinitionForm', () => ({
  MessageDigestDefinitionForm: (props: MessageDigestDefinitionFormProps): React.JSX.Element => {
    mocks.captureFormProps(props);
    return (
      <section aria-label="Definition form">
        <span>{props.initialValue?.name ?? 'New definition'}</span>
        {props.submitError === null ? null : <p>{props.submitError}</p>}
        <button
          type="button"
          onClick={(): void => {
            void props.onSubmit(mocks.formInput);
          }}
        >
          Submit editor
        </button>
        <button
          type="button"
          onClick={(): void => {
            props.onCancel(true);
          }}
        >
          Cancel dirty editor
        </button>
        <button
          type="button"
          onClick={(): void => {
            props.onCancel(false);
          }}
        >
          Cancel clean editor
        </button>
        <button
          type="button"
          onClick={(): void => {
            props.onDirtyChange?.(true);
          }}
        >
          Mark editor dirty
        </button>
      </section>
    );
  },
}));

import { WhatsAppMessageDigestEditPage } from '../WhatsAppMessageDigestEditPage.js';
import { WhatsAppMessageDigestNewPage } from '../WhatsAppMessageDigestNewPage.js';

describe('WhatsAppMessageDigestNewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formInput = editorInput();
    mocks.createDigest.mockResolvedValue({
      disposition: 'created',
      activationAdjusted: 'delivery_setup_required',
      definition: definition('digest-created'),
    });
    mocks.useMessageDigestCommands.mockReturnValue(commandsResult());
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(readinessResult());
  });

  afterEach(() => {
    cleanup();
  });

  it('creates once and navigates to the canonical detail with activation context', async () => {
    const user = userEvent.setup();
    renderNewPage();

    expect(screen.getByRole('heading', { name: 'New Message Digest' })).toBeInTheDocument();
    expect(lastFormProps().mode).toBe('create');
    expect(lastFormProps().deliveryReadiness).toMatchObject({ status: 'ready' });

    await user.click(screen.getByRole('button', { name: 'Mark editor dirty' }));
    await user.click(screen.getByRole('button', { name: 'Submit editor' }));

    await waitFor(() => expect(mocks.createDigest).toHaveBeenCalledWith(editorInput()));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-created'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '"activationAdjusted":"delivery_setup_required"'
    );
  });

  it('keeps the edited values visible for the explicit submit after ambiguous recovery stops', async () => {
    const user = userEvent.setup();
    const changedInput = { ...editorInput(), name: 'Changed fishing brief' };
    mocks.formInput = changedInput;
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error:
          'A previous create request used different values and may already have succeeded. Check the Message Digests list, then submit again to start a new request.',
      })
    );
    renderNewPage();

    expect(
      screen.getByText(
        'A previous create request used different values and may already have succeeded. Check the Message Digests list, then submit again to start a new request.'
      )
    ).toBeInTheDocument();
    expect(lastFormProps().submitError).toContain('submit again');

    await user.click(screen.getByRole('button', { name: 'Submit editor' }));

    await waitFor(() => expect(mocks.createDigest).toHaveBeenCalledWith(changedInput));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-created'
    );
  });

  it('guards dirty cancellation and lets a clean form leave immediately', async () => {
    const user = userEvent.setup();
    const view = renderNewPage();

    await user.click(screen.getByRole('button', { name: 'Mark editor dirty' }));
    await user.click(screen.getByRole('button', { name: 'Cancel dirty editor' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );

    view.unmount();
    renderNewPage();
    await user.click(screen.getByRole('button', { name: 'Cancel clean editor' }));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
  });

  it('blocks sidebar, browser Back, local Back, and Cancel, then resumes the exact navigation', async () => {
    const user = userEvent.setup();
    renderNewPage();
    await user.click(screen.getByRole('button', { name: 'Mark editor dirty' }));

    const sidebarLink = screen.getByRole('link', { name: 'Sidebar destination' });
    await user.click(sidebarLink);
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(sidebarLink).toHaveFocus());
    expect(screen.getByRole('heading', { name: 'New Message Digest' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await user.click(screen.getByRole('button', { name: 'Back to Message Digests' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await user.click(screen.getByRole('button', { name: 'Cancel dirty editor' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
  });
});

describe('WhatsAppMessageDigestEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formInput = {
      ...editorInput(),
      name: 'Renamed fishing brief',
    };
    mocks.updateDigest.mockResolvedValue({
      ...definition('digest-edit'),
      revision: 8,
      name: 'Renamed fishing brief',
    });
    mocks.definitionRefreshWithResult.mockResolvedValue(true);
    mocks.useMessageDigestCommands.mockReturnValue(commandsResult());
    mocks.useMessageDigestDefinition.mockReturnValue(definitionResult());
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(readinessResult());
  });

  afterEach(() => {
    cleanup();
  });

  it('hydrates a locked source and sends a minimal CAS patch', async () => {
    const user = userEvent.setup();
    renderEditPage();

    expect(screen.getByRole('heading', { name: 'Edit Message Digest' })).toBeInTheDocument();
    expect(lastFormProps().initialValue).toMatchObject({
      name: 'Daily fishing brief',
      sourceLocked: true,
      source: {
        chatId: 'chat-fishing',
        chatType: 'group',
        displayName: 'Fishing group',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Mark editor dirty' }));
    await user.click(screen.getByRole('button', { name: 'Submit editor' }));

    await waitFor(() =>
      expect(mocks.updateDigest).toHaveBeenCalledWith('digest-edit', {
        expectedRevision: 7,
        patch: { name: 'Renamed fishing brief' },
      })
    );
    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-edit'
    );
  });

  it('includes a cadence-only schedule change in the CAS patch', async () => {
    const user = userEvent.setup();
    mocks.formInput = {
      ...editorInput(),
      schedule: {
        kind: 'weekly',
        weekday: 'sunday',
        localTime: '07:30',
        timeZone: 'Europe/Warsaw',
      },
    };
    renderEditPage();

    await user.click(screen.getByRole('button', { name: 'Submit editor' }));

    await waitFor(() =>
      expect(mocks.updateDigest).toHaveBeenCalledWith('digest-edit', {
        expectedRevision: 7,
        patch: { schedule: mocks.formInput.schedule },
      })
    );
  });

  it('blocks external SPA navigation for dirty edits and allows clean navigation', async () => {
    const user = userEvent.setup();
    const view = renderEditPage();
    await user.click(screen.getByRole('button', { name: 'Mark editor dirty' }));
    await user.click(screen.getByRole('link', { name: 'Sidebar destination' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent('/intex-agent/sessions');

    view.unmount();
    renderEditPage();
    await user.click(screen.getByRole('link', { name: 'Sidebar destination' }));
    expect(await screen.findByTestId('location-probe')).toHaveTextContent('/intex-agent/sessions');
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument();
  });

  it('offers an explicit latest-version reload after a revision conflict', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'Refresh and retry',
        hasRevisionConflict: true,
      })
    );
    renderEditPage();

    expect(screen.getByText('Refresh and retry')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload latest version' }));

    await waitFor(() => expect(mocks.definitionRefreshWithResult).toHaveBeenCalledTimes(1));
    expect(mocks.clearError).toHaveBeenCalledTimes(1);
  });

  it('keeps the conflict and stale form explicit when latest-version reload fails', async () => {
    const user = userEvent.setup();
    mocks.definitionRefreshWithResult.mockResolvedValueOnce(false);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({
        error: 'Refresh and retry',
        hasRevisionConflict: true,
      })
    );
    renderEditPage();

    await user.click(screen.getByRole('button', { name: 'Reload latest version' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest version could not be loaded. Your current form was kept.'
    );
    expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeEnabled();
    expect(screen.getByText('Daily fishing brief')).toBeInTheDocument();
    expect(mocks.clearError).not.toHaveBeenCalled();
  });

  it('shows the same neutral state for every owner-safe 404', () => {
    mocks.useMessageDigestDefinition.mockReturnValue(
      definitionResult({ definition: null, isNotFound: true })
    );
    renderEditPage();

    expect(screen.getByRole('heading', { name: 'Message Digest not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Message Digests' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests'
    );
    expect(document.body).not.toHaveTextContent('digest-edit');
  });
});

function renderNewPage(): ReturnType<typeof render> {
  return renderEditorRoutes('/whatsapp/message-digests/new', <WhatsAppMessageDigestNewPage />);
}

function renderEditPage(): ReturnType<typeof render> {
  return renderEditorRoutes(
    '/whatsapp/message-digests/digest-edit/edit',
    <WhatsAppMessageDigestEditPage />
  );
}

function renderEditorRoutes(
  initialEntry: string,
  element: React.ReactNode
): ReturnType<typeof render> {
  const editorElement = (
    <>
      {element}
      <NavigationHarness />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: '/history-origin', element: <LocationProbe /> },
      { path: '/whatsapp/message-digests/new', element: editorElement },
      { path: '/whatsapp/message-digests/:definitionId/edit', element: editorElement },
      { path: '/whatsapp/message-digests/:definitionId', element: <LocationProbe /> },
      { path: '/whatsapp/message-digests', element: <LocationProbe /> },
      { path: '/intex-agent/sessions', element: <LocationProbe /> },
    ],
    { initialEntries: ['/history-origin', initialEntry], initialIndex: 1 }
  );
  return render(<RouterProvider router={router} />);
}

function NavigationHarness(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <nav aria-label="Test navigation">
      <Link to="/intex-agent/sessions">Sidebar destination</Link>
      <button type="button" onClick={(): void => void navigate(-1)}>
        Browser Back
      </button>
    </nav>
  );
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <pre data-testid="location-probe">
      {location.pathname} {JSON.stringify(location.state)}
    </pre>
  );
}

function lastFormProps(): MessageDigestDefinitionFormProps {
  const props = mocks.captureFormProps.mock.lastCall?.[0];
  if (props === undefined) throw new Error('MessageDigestDefinitionForm was not rendered');
  return props as MessageDigestDefinitionFormProps;
}

function commandsResult(
  overrides: Partial<UseMessageDigestCommandsResult> = {}
): UseMessageDigestCommandsResult {
  return {
    error: null,
    hasRevisionConflict: false,
    preparation: null,
    requiresRunReconfirmation: false,
    isCreating: false,
    isUpdating: false,
    isPreparingRun: false,
    isConfirmingRun: false,
    isRecoveringRun: false,
    pendingRunRecoveryDefinitionId: null,
    createDigest: mocks.createDigest,
    updateDigest: mocks.updateDigest,
    prepareRun: vi.fn(),
    confirmRun: vi.fn(),
    recoverPendingRun: vi.fn(),
    finishRunRequest: vi.fn(),
    clearError: mocks.clearError,
    ...overrides,
  };
}

function definitionResult(
  overrides: Partial<UseMessageDigestDefinitionResult> = {}
): UseMessageDigestDefinitionResult {
  return {
    definition: definition('digest-edit'),
    isLoading: false,
    isRefreshing: false,
    isNotFound: false,
    error: null,
    refresh: mocks.definitionRefresh,
    refreshWithResult: mocks.definitionRefreshWithResult,
    adoptDefinition: mocks.definitionAdopt,
    ...overrides,
  };
}

function readinessResult(): UseMessageDigestDeliveryReadinessResult {
  return {
    readiness: {
      status: 'ready',
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    },
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: mocks.readinessRefresh,
  };
}

function editorInput(): CreateMessageDigestInput {
  return {
    status: 'active',
    name: 'Daily fishing brief',
    source: { chatId: 'chat-fishing' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize the important fishing facts supported by messages.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
  };
}

function definition(id: string): MessageDigestDefinition {
  return {
    id,
    name: 'Daily fishing brief',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 7,
    sourceLocked: true,
    source: {
      chatId: 'chat-fishing',
      chatType: 'group',
      displayName: 'Fishing group',
    },
    instructions: editorInput().instructions,
    schedule: editorInput().schedule,
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-27T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: null,
    latestRun: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

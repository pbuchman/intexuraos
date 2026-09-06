/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
  FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
} from '@intexuraos/llm-prompts/message-digest/templates';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateWhatsAppChat } from '@/types';
import type { MessageDigestDeliveryReadiness } from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listPrivateWhatsAppChats: vi.fn(),
  previewMessageDigestSchedule: vi.fn(),
  previewMessageDigest: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    getAccessToken: typeof mocks.getAccessToken;
    user: { sub: string };
  } => ({
    getAccessToken: mocks.getAccessToken,
    user: { sub: 'account-a' },
  }),
}));

vi.mock('@/services/whatsappApi', () => ({
  listPrivateWhatsAppChats: mocks.listPrivateWhatsAppChats,
}));

vi.mock('@/services/messageDigestsApi', () => ({
  previewMessageDigestSchedule: mocks.previewMessageDigestSchedule,
  previewMessageDigest: mocks.previewMessageDigest,
}));

import {
  MessageDigestDefinitionForm,
  type MessageDigestDefinitionFormProps,
  type MessageDigestFormValue,
} from '../MessageDigestDefinitionForm.js';

describe('MessageDigestDefinitionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('test-token');
    mocks.listPrivateWhatsAppChats.mockResolvedValue({ chats: [groupChat(), directChat()] });
    mocks.previewMessageDigestSchedule.mockResolvedValue({
      evaluatedAt: '2026-07-27T12:00:00.000Z',
      precedingBoundary: '2026-07-27T05:30:00.000Z',
      nextBoundary: '2026-07-28T05:30:00.000Z',
      timeZone: 'Europe/Warsaw',
    });
    mocks.previewMessageDigest.mockResolvedValue({
      status: 'generated',
      window: {
        start: '2026-07-27T05:30:00.000Z',
        end: '2026-07-28T05:30:00.000Z',
        timeZone: 'Europe/Warsaw',
      },
      source: { chatType: 'group', displayName: 'Fishing friends' },
      deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '•••• 1234' },
      messageCount: 17,
      content: { headline: 'Today on the water', summaryMarkdown: '**Two plans** were agreed.' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('validates every required section and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole('button', { name: 'Create digest' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Create digest' }));

    expect(screen.getByLabelText('Digest name')).toHaveFocus();
    expect(screen.getByText('Fix 3 fields before saving.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Enter a digest name.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Choose a WhatsApp conversation.')).toHaveAttribute('role', 'alert');
    expect(
      screen.getByText('Instructions must contain at least 20 characters.')
    ).toHaveAttribute('role', 'alert');
  });

  it('updates and clears the attempted-validation summary as fields are corrected', async () => {
    const user = userEvent.setup();
    renderForm({
      initialValue: validValue({
        name: '',
        instructions: { templateId: 'custom', text: 'Too short' },
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    expect(screen.getByText('Fix 2 fields before saving.')).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText('Digest name')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Digest name'), {
      target: { value: 'Morning digest' },
    });
    expect(screen.getByText('Fix 1 field before saving.')).toHaveAttribute('role', 'alert');

    fireEvent.change(screen.getByLabelText('Summary instructions'), {
      target: { value: 'Summarize decisions, open questions, and important facts.' },
    });
    expect(screen.queryByText(/fields? before saving\./u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create digest' })).toBeEnabled();
  });

  it('trims the digest name and exposes its 80-character bound, count, error, and focus', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ initialValue: validValue(), onSubmit });
    const name = screen.getByLabelText('Digest name');

    fireEvent.change(name, { target: { value: 'n'.repeat(80) } });
    expect(screen.getByText('80 / 80')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create digest' })).toBeEnabled();

    fireEvent.change(name, { target: { value: 'n'.repeat(81) } });
    expect(screen.getByText('81 / 80')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    expect(screen.getByText('Digest name must be 80 characters or fewer.')).toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-describedby', 'digest-name-error digest-name-count');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the selected source activity snapshot and an honest legacy fallback without IDs', () => {
    const first = renderForm({ initialValue: validValue() });
    expect(screen.getByText('123 messages')).toBeInTheDocument();
    expect(screen.getByText('8 participants')).toBeInTheDocument();
    expect(screen.getByText(/^Active /u)).toBeInTheDocument();
    expect(first.container).not.toHaveTextContent('chat-group');
    first.unmount();

    renderForm({
      initialValue: validValue({
        source: {
          chatId: 'legacy-chat',
          chatType: 'direct',
          displayName: 'Legacy conversation',
        },
      }),
    });
    expect(screen.getByText('Activity snapshot unavailable')).toBeInTheDocument();
    expect(screen.queryByText('legacy-chat')).not.toBeInTheDocument();
  });

  it('keeps multiline Enter inside the editor and associates its count and 20–4,000 errors', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ initialValue: validValue(), onSubmit });
    const editor = screen.getByLabelText('Summary instructions');

    await user.click(editor);
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(editor, {
      target: { value: `${validValue().instructions.text}\nA second line` },
    });
    expect(editor).toHaveValue(`${validValue().instructions.text}\nA second line`);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: 'x'.repeat(19) } });
    expect(screen.getByText('19 / 4000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    expect(screen.getByText('Instructions must contain at least 20 characters.')).toBeInTheDocument();
    expect(editor).toHaveAttribute(
      'aria-describedby',
      'digest-instructions-error digest-instructions-count'
    );

    fireEvent.change(editor, { target: { value: 'x'.repeat(4_001) } });
    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    expect(screen.getByText('Instructions must be 4000 characters or fewer.')).toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it.each([
    ['name', validValue({ name: '' })],
    ['source', validValue({ source: null })],
    [
      'instructions',
      validValue({ instructions: { templateId: 'custom', text: 'Too short' } }),
    ],
    ['daily time', validValue({ schedule: { ...validValue().schedule, localTime: '' } })],
    [
      'time zone',
      validValue({ schedule: { ...validValue().schedule, timeZone: 'Not/A_Time_Zone' } }),
    ],
  ] as const)('keeps Create digest actionable for an invalid %s', (_field, initialValue) => {
    renderForm({ initialValue });

    expect(screen.getByRole('button', { name: 'Create digest' })).toBeEnabled();
  });

  it('enables Create digest once every known client-side field is valid', () => {
    renderForm({ initialValue: validValue() });

    expect(screen.getByRole('button', { name: 'Create digest' })).toBeEnabled();
  });

  it('locks cancel, preview, and submit while one save mutation is pending', () => {
    renderForm({ initialValue: validValue(), isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview summary' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it.each([
    ['Fishing friends', 'Fishing group', FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS],
    ['Alex', 'Sentiment and outcomes', DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS],
  ] as const)(
    'selecting %s inserts the matching editable template into empty instructions',
    async (conversationName, templateLabel, expectedInstructions) => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole('button', { name: 'Choose conversation' }));
      await user.click(await screen.findByRole('button', { name: new RegExp(conversationName) }));
      await user.click(await screen.findByRole('button', { name: 'Use conversation' }));

      expect(screen.getByText(conversationName)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: templateLabel })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Summary instructions')).toHaveValue(expectedInstructions);
      expect(screen.queryByLabelText(/recipient|phone number/i)).not.toBeInTheDocument();
    }
  );

  it('uses the exact approved direct-sentiment prompt with uncertainty and anti-diagnosis safeguards', () => {
    renderForm({
      initialValue: validValue({
        source: { chatId: 'chat-direct', chatType: 'direct', displayName: 'Alex' },
        instructions: {
          templateId: 'direct_sentiment',
          text: DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
        },
      }),
    });

    const instructions = screen.getByLabelText('Summary instructions');
    expect(instructions).toHaveValue(DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS);
    expect(DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS).toContain(
      'Distinguish observation from inference, state uncertainty'
    );
    expect(DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS).toContain(
      'do not diagnose mental state, personality, health, or hidden intent'
    );
  });

  it.each([
    [
      'group to direct',
      validValue({
        instructions: {
          templateId: 'fishing_group',
          text: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
        },
      }),
      'Alex',
      'Sentiment and outcomes',
      DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
    ],
    [
      'direct to group',
      validValue({
        source: { chatId: 'chat-direct', chatType: 'direct', displayName: 'Alex' },
        instructions: {
          templateId: 'direct_sentiment',
          text: DIRECT_SENTIMENT_MESSAGE_DIGEST_INSTRUCTIONS,
        },
      }),
      'Fishing friends',
      'Fishing group',
      FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
    ],
  ] as const)(
    'switches an untouched default template when the source changes %s',
    async (_label, initialValue, targetName, templateLabel, expectedInstructions) => {
      const user = userEvent.setup();
      renderForm({ initialValue });

      await user.click(screen.getByRole('button', { name: 'Change conversation' }));
      await user.click(await screen.findByRole('button', { name: new RegExp(targetName) }));
      await user.click(screen.getByRole('button', { name: 'Use conversation' }));

      expect(screen.getByRole('button', { name: templateLabel })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Summary instructions')).toHaveValue(expectedInstructions);
    }
  );

  it.each([
    [
      'edited template',
      {
        templateId: 'fishing_group' as const,
        text: `${FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS}\nKeep exact weather details.`,
      },
    ],
    [
      'custom instructions',
      {
        templateId: 'custom' as const,
        text: 'Preserve this custom instruction text byte-for-byte across source changes.',
      },
    ],
  ])('preserves %s when the source changes', async (_label, instructions) => {
    const user = userEvent.setup();
    renderForm({ initialValue: validValue({ instructions }) });

    await user.click(screen.getByRole('button', { name: 'Change conversation' }));
    await user.click(await screen.findByRole('button', { name: /Alex/u }));
    await user.click(screen.getByRole('button', { name: 'Use conversation' }));

    expect(screen.getByLabelText('Summary instructions')).toHaveValue(instructions.text);
  });

  it('requires confirmation before replacing non-empty instructions with a template', async () => {
    const user = userEvent.setup();
    renderForm({ initialValue: validValue() });
    const textarea = screen.getByLabelText('Summary instructions');
    expect(textarea).toHaveValue(validValue().instructions.text);

    await user.click(screen.getByRole('button', { name: 'Fishing group' }));
    expect(
      screen.getByRole('dialog', { name: 'Replace current instructions?' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep current instructions' }));
    expect(textarea).toHaveValue(validValue().instructions.text);

    await user.click(screen.getByRole('button', { name: 'Fishing group' }));
    await user.click(screen.getByRole('button', { name: 'Replace instructions' }));
    expect(textarea).toHaveValue(FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS);
    expect(textarea).toHaveFocus();
  });

  it('switches to Custom without mutating instructions and returns focus to the editor', async () => {
    const user = userEvent.setup();
    const initial = validValue({
      instructions: {
        templateId: 'fishing_group',
        text: FISHING_GROUP_MESSAGE_DIGEST_INSTRUCTIONS,
      },
    });
    renderForm({ initialValue: initial });
    const textarea = screen.getByLabelText('Summary instructions');
    await user.click(textarea);
    await user.type(textarea, ' Keep weather details.');
    const editedText = (textarea as HTMLTextAreaElement).value;

    await user.click(screen.getByRole('button', { name: 'Custom instructions' }));

    expect(textarea).toHaveValue(editedText);
    expect(textarea).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Custom instructions' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('shows backend-calculated schedule boundaries and a masked read-only delivery destination', async () => {
    renderForm({ initialValue: validValue() });

    await waitFor(() => expect(mocks.previewMessageDigestSchedule).toHaveBeenCalledTimes(1));
    expect(mocks.previewMessageDigestSchedule).toHaveBeenCalledWith(
      'test-token',
      {
        schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
      },
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
    expect(await screen.findByText(/Next delivery:/)).toHaveTextContent('Jul 28, 2026');
    expect(screen.getByText(/Summaries will be sent to/)).toHaveTextContent('•••• 1234');
    expect(document.body.textContent).not.toMatch(/\+?\d{8,}/u);
  });

  it('previews and submits the exact weekly schedule selected in the form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ initialValue: validValue(), onSubmit });

    await user.click(screen.getByRole('radio', { name: 'Weekly' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Day of week' }), 'sunday');

    await waitFor(() =>
      expect(mocks.previewMessageDigestSchedule).toHaveBeenLastCalledWith(
        'test-token',
        {
          schedule: {
            kind: 'weekly',
            weekday: 'sunday',
            localTime: '07:30',
            timeZone: 'Europe/Warsaw',
          },
        },
        expect.objectContaining({ refreshToken: mocks.getAccessToken })
      )
    );
    await user.click(screen.getByRole('button', { name: 'Create digest' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          kind: 'weekly',
          weekday: 'sunday',
          localTime: '07:30',
          timeZone: 'Europe/Warsaw',
        },
      })
    );
  });

  it.each([
    ['mapping_missing', 'No primary WhatsApp number is mapped'],
    ['disconnected', 'WhatsApp delivery is disconnected'],
    ['delivery_disabled', 'WhatsApp delivery is disabled'],
  ] as const)(
    'explains readiness %s and that an active digest may be saved paused',
    (status, copy) => {
      renderForm({ deliveryReadiness: readiness(status), initialValue: validValue() });
      expect(screen.getByText(copy)).toBeInTheDocument();
      expect(
        screen.getByText(/The service may save an active digest as paused/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open WhatsApp settings' })).toHaveAttribute(
        'href',
        '/settings/whatsapp'
      );
    }
  );

  it('submits trimmed values without recipient data', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({
      initialValue: validValue({
        name: '  Morning digest  ',
        instructions: { templateId: 'custom', text: `  ${validValue().instructions.text}  ` },
      }),
      onSubmit,
    });

    await user.click(screen.getByRole('button', { name: 'Create digest' }));

    expect(onSubmit).toHaveBeenCalledWith({
      status: 'active',
      name: 'Morning digest',
      source: { chatId: 'chat-group' },
      instructions: { templateId: 'custom', text: validValue().instructions.text },
      schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    });
    expect(JSON.stringify(onSubmit.mock.calls[0]?.[0])).not.toMatch(
      /recipient|phoneNumber|userId|sourceAccountId/u
    );
  });

  it('renders a generated Markdown preview from the exact backend window without mutating the form', async () => {
    const user = userEvent.setup();
    renderForm({ initialValue: validValue() });
    const before = (screen.getByLabelText('Summary instructions') as HTMLTextAreaElement).value;

    await user.click(screen.getByRole('button', { name: 'Preview summary' }));

    const previewDialog = await screen.findByRole('dialog', { name: 'Digest preview' });
    expect(previewDialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today on the water' })).toBeInTheDocument();
    expect(screen.getByText('Two plans')).toBeInTheDocument();
    expect(screen.getByText(/17 messages/)).toBeInTheDocument();
    expect(within(previewDialog).getByText(/Jul 27, 2026/)).toBeInTheDocument();
    expect(mocks.previewMessageDigest).toHaveBeenCalledWith(
      'test-token',
      {
        source: { chatId: 'chat-group' },
        instructions: validValue().instructions,
        schedule: validValue().schedule,
      },
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
    expect(screen.getByLabelText('Summary instructions')).toHaveValue(before);
    expect(within(previewDialog).queryByText(/will be sent/i)).not.toBeInTheDocument();
  });

  it('repeats an identical read-only preview without saving or delivering', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ initialValue: validValue(), onSubmit });

    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    const firstDialog = await screen.findByRole('dialog', { name: 'Digest preview' });
    const firstClose = within(firstDialog).getAllByRole('button', { name: 'Close preview' })[0];
    if (firstClose === undefined) throw new Error('Expected a preview close control');
    await user.click(firstClose);
    await user.click(screen.getByRole('button', { name: 'Preview summary' }));
    await screen.findByRole('dialog', { name: 'Digest preview' });

    expect(mocks.previewMessageDigest).toHaveBeenCalledTimes(2);
    expect(mocks.previewMessageDigest.mock.calls[1]?.[1]).toEqual(
      mocks.previewMessageDigest.mock.calls[0]?.[1]
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows no-activity preview and recovers from a preview error without closing', async () => {
    const user = userEvent.setup();
    mocks.previewMessageDigest
      .mockRejectedValueOnce(new Error('Preview unavailable'))
      .mockResolvedValueOnce({
        status: 'no_activity',
        window: {
          start: '2026-07-27T05:30:00.000Z',
          end: '2026-07-28T05:30:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        source: { chatType: 'group', displayName: 'Fishing friends' },
        deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '•••• 1234' },
        messageCount: 0,
        content: null,
      });
    renderForm({ initialValue: validValue() });
    await user.click(screen.getByRole('button', { name: 'Preview summary' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
    await user.click(screen.getByRole('button', { name: 'Try preview again' }));
    expect(await screen.findByText('No new activity in this window')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Digest preview' })).toBeInTheDocument();
  });

  it('preserves form state across preview retry and returns focus on close without persisting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mocks.previewMessageDigest
      .mockRejectedValueOnce(new Error('Preview unavailable'))
      .mockResolvedValueOnce({
        status: 'no_activity',
        window: {
          start: '2026-07-27T05:30:00.000Z',
          end: '2026-07-28T05:30:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        source: { chatType: 'group', displayName: 'Fishing friends' },
        deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '•••• 1234' },
        messageCount: 0,
        content: null,
      });
    renderForm({ initialValue: validValue(), onSubmit });
    const previewTrigger = screen.getByRole('button', { name: 'Preview summary' });
    const name = screen.getByLabelText('Digest name');
    await user.type(name, ' edited');

    await user.click(previewTrigger);
    const dialog = await screen.findByRole('dialog', { name: 'Digest preview' });
    await user.click(within(dialog).getByRole('button', { name: 'Try preview again' }));
    expect(await screen.findByText('No new activity in this window')).toBeInTheDocument();
    expect(name).toHaveValue('Morning digest edited');
    const close = within(dialog).getAllByRole('button', { name: 'Close preview' })[0];
    if (close === undefined) throw new Error('Expected a preview close control');
    await user.click(close);

    await waitFor(() => expect(previewTrigger).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tracks dirty state for Cancel and beforeunload, but keeps a locked source immutable', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderForm({
      mode: 'edit',
      initialValue: validValue({ sourceLocked: true }),
      onCancel,
    });

    expect(screen.getByRole('button', { name: 'Change conversation' })).toBeDisabled();
    expect(screen.getByText(/can’t be changed after the first run/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Digest name'), ' changed');
    const event = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith(true);
  });
});

function renderForm(
  overrides: Partial<MessageDigestDefinitionFormProps> = {}
): ReturnType<typeof render> {
  const props: MessageDigestDefinitionFormProps = {
    mode: 'create',
    deliveryReadiness: readiness('ready'),
    deliveryReadinessLoading: false,
    deliveryReadinessError: null,
    isSubmitting: false,
    submitError: null,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <MessageDigestDefinitionForm {...props} />
    </MemoryRouter>
  );
}

function validValue(overrides: Partial<MessageDigestFormValue> = {}): MessageDigestFormValue {
  return {
    status: 'active',
    name: 'Morning digest',
    source: {
      chatId: 'chat-group',
      chatType: 'group',
      displayName: 'Fishing friends',
      messageCount: 123,
      participantCount: 8,
      lastActivityAt: '2026-07-27T11:00:00.000Z',
    },
    sourceLocked: false,
    instructions: {
      templateId: 'custom',
      text: 'Summarize concrete decisions, open questions, and the most important new facts.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    ...overrides,
  };
}

function readiness(
  status: MessageDigestDeliveryReadiness['status']
): MessageDigestDeliveryReadiness {
  if (status === 'ready') {
    return {
      status,
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    };
  }
  return {
    status,
    observationVersion: 'mapping-v1',
    observedAt: '2026-07-27T12:00:00.000Z',
  };
}

function groupChat(): PrivateWhatsAppChat {
  return {
    id: 'chat-group',
    chatType: 'group',
    displayName: 'Fishing friends',
    messageCount: 124,
    participantCount: 8,
    firstSeenAt: '2026-07-20T08:00:00.000Z',
    lastEventAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
  };
}

function directChat(): PrivateWhatsAppChat {
  return {
    id: 'chat-direct',
    chatType: 'direct',
    displayName: 'Alex',
    messageCount: 42,
    participantCount: 1,
    firstSeenAt: '2026-07-21T08:00:00.000Z',
    lastEventAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
  };
}

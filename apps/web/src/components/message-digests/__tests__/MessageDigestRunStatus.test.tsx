/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { LegacyGoogleModels } from '@intexuraos/llm-contract';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageDigestRun, MessageDigestProcessingStage } from '@/types/messageDigests';
import { MessageDigestRunStatus } from '../MessageDigestRunStatus.js';

describe('MessageDigestRunStatus', () => {
  afterEach(() => {
    cleanup();
  });

  it.each<[MessageDigestProcessingStage, string]>([
    ['queued', 'Queued'],
    ['reading_messages', 'Reading messages'],
    ['aggregating', 'Generating'],
    ['repairing', 'Repairing summary'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['skipped_no_activity', 'Skipped — no new messages'],
  ])('renders the exact processing stage %s as %s', (processingStage, expected) => {
    render(<MessageDigestRunStatus run={runForStage(processingStage)} />);

    expect(screen.getByTestId('generation-status')).toHaveTextContent(expected);
  });

  it('keeps generation and WhatsApp delivery as independent labelled states', () => {
    render(
      <MessageDigestRunStatus
        run={{
          ...runForStage('completed'),
          generationStatus: 'completed',
          delivery: {
            ...runForStage('completed').delivery,
            status: 'failed',
            failedAt: '2026-07-27T07:31:00.000Z',
            failureCode: 'provider_rejected',
          },
        }}
      />
    );

    expect(screen.getByTestId('generation-status')).toHaveTextContent('Completed');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Failed');
    expect(screen.getByText('Generation')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('announces active progress politely and uses Sent only for confirmed delivery', () => {
    const activeRun = runForStage('aggregating');
    const { rerender } = render(
      <MessageDigestRunStatus
        run={{ ...activeRun, delivery: { ...activeRun.delivery, status: 'pending' } }}
      />
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Pending');
    expect(screen.queryByText('Sent')).not.toBeInTheDocument();

    rerender(
      <MessageDigestRunStatus
        run={{
          ...runForStage('completed'),
          delivery: {
            ...runForStage('completed').delivery,
            status: 'sent',
            acceptedAt: '2026-07-27T07:31:00.000Z',
          },
        }}
      />
    );
    expect(screen.getByTestId('delivery-status')).toHaveTextContent('Sent');
  });
});

function runForStage(processingStage: MessageDigestProcessingStage): MessageDigestRun {
  const terminal =
    processingStage === 'completed' ||
    processingStage === 'failed' ||
    processingStage === 'skipped_no_activity';
  return {
    id: 'run-a',
    definitionId: 'digest-a',
    trigger: 'manual',
    window: {
      start: '2026-07-26T05:30:00.000Z',
      end: '2026-07-27T05:30:00.000Z',
      scheduledBoundary: '2026-07-27T05:30:00.000Z',
    },
    generationStatus:
      processingStage === 'failed'
        ? 'failed'
        : processingStage === 'skipped_no_activity'
          ? 'skipped_no_activity'
          : processingStage === 'completed'
            ? 'completed'
            : processingStage === 'queued'
              ? 'queued'
              : 'processing',
    processingStage,
    attempts: 1,
    source: { chatType: 'group', displayName: 'Fishing group' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize only important facts that are supported by source messages.',
      revision: 'instructions-v1',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    content:
      processingStage === 'completed'
        ? {
            headline: 'Fishing update',
            summaryMarkdown: 'Two plans were agreed.',
            evidenceMessageRefs: [],
          }
        : null,
    effectiveMessageCount: terminal ? 17 : null,
    promptVersion: terminal ? 'message-digest-v1' : null,
    model: terminal ? LegacyGoogleModels.Gemini25Flash : null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary',
      status: processingStage === 'completed' ? 'pending' : 'not_sent',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
    },
    safeFailureCode: processingStage === 'failed' ? 'generation_failed' : null,
    createdAt: '2026-07-27T07:30:00.000Z',
    updatedAt: '2026-07-27T07:30:30.000Z',
    completedAt: terminal ? '2026-07-27T07:30:30.000Z' : null,
  };
}

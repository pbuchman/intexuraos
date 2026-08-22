import { getErrorMessage, type Result } from '@intexuraos/common-core';
import {
  calendarEventDateTimeSchema,
  calendarUpdateEventChangesSchema,
} from '@intexuraos/http-contracts';
import type {
  IntexAgentRuntimeSettingsClientError,
  IntexAgentRuntimeSettingsV1,
} from '@intexuraos/internal-clients';
import { isIntexAgentModel, type IntexAgentModel } from '@intexuraos/llm-contract';
import type { WhatsAppInteractiveButton } from '@intexuraos/whatsapp-pubsub-client';
import type { IntexIncomingMessage, IncomingMessageHandlerResult } from '../ports/incomingMessageHandler.js';
import type { SessionRepository } from '../ports/sessionRepository.js';
import {
  decideSessionTransition,
  type SessionTransitionDecision,
} from '../sessions/sessionController.js';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  IntexAgentSessionEventType,
  IntexAgentToolName,
} from '../sessions/types.js';
import { normalizeSessionTimestamp } from '../sessions/sessionTimestamps.js';
import {
  buildNewSessionReadyText,
  selectIntexAgentReplyLanguage,
  type IntexAgentLanguageMessage,
  type IntexAgentReplyLanguage,
} from '../agent/capabilities.js';
import type { CalendarEventDraftV1 } from '../agent/calendarEventReadiness.js';
import { isWhatsAppImageWithSourceUrl } from '../agent/intexAgentRunner.js';

const CONFIRMATION_BUTTON_LABELS: Record<
  IntexAgentReplyLanguage,
  { yes: string; no: string }
> = {
  en: { yes: 'Yes', no: 'No' },
  pl: { yes: 'Tak', no: 'Nie' },
};
const COMPLETED_FOLLOW_UP_PROMPTS: Record<IntexAgentReplyLanguage, string> = {
  en: 'What can I help with next?',
  pl: 'Co mogę teraz dla Ciebie zrobić?',
};
const CALENDAR_PROPOSAL_BYPASS_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not safely prepare the calendar event for confirmation. Please restate the event details, and I will verify them before asking whether to add it.',
  pl: 'Nie udało mi się bezpiecznie przygotować wydarzenia do potwierdzenia. Podaj ponownie szczegóły, a zweryfikuję je przed pytaniem, czy dodać wydarzenie.',
};

export type IntexAgentFallbackReason =
  | 'classifier_unsupported'
  | 'runner_declared_unsupported'
  | 'runner_output_malformed'
  | 'tool_result_mismatch'
  | 'llm_call_failed'
  | 'runtime_resolution_failed';

export type IntexAgentRuntimeSnapshot = Readonly<
  | {
      status: 'available';
      effectiveModel: IntexAgentModel;
      timeZone: string;
      source: 'explicit' | 'default_absent';
      explicitModel: IntexAgentModel | null;
      revision: number;
    }
  | {
      status: 'unavailable';
      effectiveModel: IntexAgentModel;
      timeZone: string;
      source: 'platform_default';
    }
>;

export interface IntexAgentToolSelectionMetadata {
  turnIndex: number;
  ordinal: number;
}

export interface IntexAgentSupportingToolCompletion {
  toolName: IntexAgentToolName;
  result: Record<string, unknown>;
  toolSelection?: IntexAgentToolSelectionMetadata;
}

export interface IntexAgentConfirmedOperation {
  toolName: IntexAgentToolName;
  toolArgs: Record<string, unknown>;
  toolSelection?: IntexAgentToolSelectionMetadata;
}

export interface IntexAgentConfirmedOperationResult {
  toolName: IntexAgentToolName;
  status: 'completed' | 'failed';
  toolSelection?: IntexAgentToolSelectionMetadata;
  toolResult?: Record<string, unknown>;
  error?: string;
}

export type IntexAgentRunnerResult =
  | {
      outcome: 'completed';
      reply: string;
      summary?: string;
      toolName?: IntexAgentToolName;
      toolResult?: Record<string, unknown>;
      toolSelection?: IntexAgentToolSelectionMetadata;
      ctaUrl?: {
        displayText: string;
        url: string;
      };
      operationResults?: readonly IntexAgentConfirmedOperationResult[];
    }
  | {
      outcome: 'needs_confirmation';
      reply: string;
      toolName: IntexAgentToolName;
      toolArgs: Record<string, unknown>;
      summary?: string;
      toolSelection?: IntexAgentToolSelectionMetadata;
      supportingToolCompletions?: readonly IntexAgentSupportingToolCompletion[];
      operations?: readonly IntexAgentConfirmedOperation[];
    }
  | {
      outcome: 'tool_failed';
      reply: string;
      toolName: IntexAgentToolName;
      error: string;
      errorCategory?: string;
      isRetryable?: boolean;
      attemptedAction?: string;
      toolSelection?: IntexAgentToolSelectionMetadata;
    }
  | {
      outcome: 'tool_selection_rejected';
      toolName: IntexAgentToolName;
      category: 'behavioral_failure' | 'safety_stop';
      code: string;
      toolSelection: IntexAgentToolSelectionMetadata;
      reply: string;
    }
  | {
      outcome: 'needs_clarification';
      reply: string;
      blockerReason?: string;
      missingFields?: string[];
      candidateIntents?: string[];
      suggestedNextStep?: string;
      clarification?: string;
      calendarEventDraft?: CalendarEventDraftV1;
      toolSelection?: IntexAgentToolSelectionMetadata;
      fallbackReason?: IntexAgentFallbackReason;
      fallbackSourceOutcome?: string;
    }
  | {
      outcome: 'no_action';
      reply: string;
    }
  | {
      outcome: 'unsupported';
      reply: string;
      blockerReason: string;
      missingFields?: string[];
      candidateIntents?: string[];
      suggestedNextStep: string;
      fallbackReason: Extract<
        IntexAgentFallbackReason,
        'classifier_unsupported' | 'runner_declared_unsupported'
      >;
      fallbackSourceOutcome?: string;
    };

export interface IntexAgentRunner {
  executeConfirmed(input: {
    session: IntexAgentSession;
    events?: IntexAgentSessionEvent[];
    currentDateTime: string;
    messageId?: string;
  } & (
    | {
        toolName: IntexAgentToolName;
        toolArgs: Record<string, unknown>;
        operations?: never;
      }
    | {
        operations: readonly IntexAgentConfirmedOperation[];
        toolName?: never;
        toolArgs?: never;
      }
  )): Promise<IntexAgentRunnerResult>;
  run(input: {
    session: IntexAgentSession;
    events: IntexAgentSessionEvent[];
    message: string;
    replyContext?: IntexIncomingMessage['replyContext'];
    sourceType?: string;
    sourceUrl?: string;
    currentDateTime: string;
    timeZone: string;
    runtimeSettings?: IntexAgentRuntimeSnapshot;
    messageId?: string;
  }): Promise<IntexAgentRunnerResult>;
}

export interface WhatsAppReplyPublisher {
  publishReply(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    correlationId: string;
    ctaUrl?: {
      displayText: string;
      url: string;
    };
    buttons?: WhatsAppInteractiveButton[];
  }): Promise<void>;
}

export interface MatrixCorpusWhatsAppReplyPublisher {
  publishReplyWithReceipt(input: {
    userId: string;
    message: string;
    replyToMessageId: string;
    idempotencyKey: string;
    buttons?: WhatsAppInteractiveButton[];
  }): Promise<Readonly<{ publicationReceiptId: string }>>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  sessionId(): string;
  eventId(): string;
  confirmationId(): string;
}

export interface HandleIncomingMessageDeps {
  sessionRepository: SessionRepository;
  runner: IntexAgentRunner;
  replyPublisher: WhatsAppReplyPublisher;
  clock: Clock;
  resolveRuntimeSettings(
    userId: string
  ): Promise<Result<IntexAgentRuntimeSettingsV1, IntexAgentRuntimeSettingsClientError>>;
  logger: { warn(value: Record<string, unknown>, message?: string): void };
  ids: IdGenerator;
  sessionTimeoutMs: number;
}

const CONFIRMABLE_TOOL_NAMES = new Set<IntexAgentToolName>([
  'create_note',
  'create_calendar_event',
  'update_calendar_event',
  'create_research',
  'create_link',
  'create_code_task',
  'save_external',
  'add_user_preference',
  'update_user_preference',
  'delete_user_preference',
]);
const CONFIRMED_CALENDAR_UPDATE_BATCH_MIN_OPERATIONS = 2;
const CONFIRMED_CALENDAR_UPDATE_BATCH_MAX_OPERATIONS = 20;
const CONFIRMED_CALENDAR_UPDATE_OPERATION_KEYS = new Set([
  'toolName',
  'toolArgs',
  'toolSelection',
]);
const CONFIRMED_CALENDAR_UPDATE_ARG_KEYS = new Set([
  'eventId',
  'eventSummary',
  'calendarId',
  'expectedEtag',
  'eventStart',
  'eventEnd',
  'changes',
]);
const CONFIRMED_CALENDAR_DATE_TIME_KEYS = new Set(['date', 'dateTime', 'timeZone']);
const CONFIRMED_TOOL_SELECTION_KEYS = new Set(['turnIndex', 'ordinal']);

const STALE_CONFIRMATION_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'This confirmation is no longer current. Send the request again.',
  pl: 'To potwierdzenie nie jest już aktualne. Wyślij prośbę jeszcze raz.',
};

const REJECTED_CONFIRMATION_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'Okay, I will not run this action.',
  pl: 'Okej, nie wykonuję tej akcji.',
};

const TOOL_EXECUTION_FAILURE_PREFIX: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not execute this action: ',
  pl: 'Nie udało się wykonać tej akcji: ',
};

const TOOL_EXECUTION_FAILURE_SUFFIX: Record<IntexAgentReplyLanguage, string> = {
  en: '. Please try again later.',
  pl: '. Spróbuj ponownie później.',
};

const MISSING_LINK_REPLIES = {
  missing: {
    en: 'I do not see a saved link from the previous action. Ask me directly again, and I will create the resource from scratch.',
    pl: 'Nie widzę zapisanego linku z poprzedniej akcji. Poproś mnie jeszcze raz wprost, a utworzę zasób od nowa.',
  },
  prefix: {
    en: 'Link from the previous action: ',
    pl: 'Link z poprzedniej akcji: ',
  },
} satisfies Record<string, Record<IntexAgentReplyLanguage, string>>;

export async function handleIncomingMessage(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps
): Promise<IncomingMessageHandlerResult> {
  const now = deps.clock.now();
  const normalizedUserTimestamp = normalizeSessionTimestamp(input.timestamp);
  const currentSession = await deps.sessionRepository.findContinuableSession(input.userId);

  if (input.sourceType === 'whatsapp_button') {
    return await handleConfirmationResponse(
      input,
      deps,
      currentSession,
      now,
      normalizedUserTimestamp
    );
  }

  const textConfirmationDecision =
    input.buttonResponse === undefined ? parsePlainTextConfirmationDecision(input.text) : null;
  if (currentSession !== null && textConfirmationDecision !== null) {
    const confirmationEvents = await deps.sessionRepository.listEvents(
      currentSession.id,
      input.userId
    );
    const pendingConfirmation = findLatestDirectTextConfirmation(confirmationEvents);
    if (pendingConfirmation !== null) {
      return await handleConfirmationResponse(
        input,
        deps,
        currentSession,
        now,
        normalizedUserTimestamp,
        {
          decision: textConfirmationDecision,
          events: confirmationEvents,
          pendingConfirmation,
        }
      );
    }
  }

  const decision = decideSessionTransition({
    currentSession,
    now,
    userMessageText: input.text,
    sessionTimeoutMs: deps.sessionTimeoutMs,
  });

  await closePreviousSessionIfNeeded(decision, deps);

  const session = await resolveSession(decision, input, deps, normalizedUserTimestamp);
  const effectiveMessage = decision.effectiveUserMessageText;

  if (effectiveMessage === null) {
    const priorEvents =
      currentSession === null ? [] : await deps.sessionRepository.listEvents(currentSession.id, input.userId);
    const reply = newSessionReadyText(input, priorEvents);
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return { sessionId: session.id };
  }

  await appendEvent(deps, session, 'user_message', {
    messageId: input.messageId,
    text: effectiveMessage,
    sourceType: input.sourceType,
    ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
    ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
    ...(input.buttonResponse !== undefined ? { buttonResponse: input.buttonResponse } : {}),
  });
  await deps.sessionRepository.updateSession(session.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const events = await deps.sessionRepository.listEvents(session.id, input.userId);
  await supersedePendingConfirmationIfNeeded(session, deps, events);
  const missingLinkReply = buildMissingLinkReply(effectiveMessage, events);
  if (missingLinkReply !== null) {
    const assistantAt = await appendAssistantMessage(session, deps, missingLinkReply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, missingLinkReply);
    return { sessionId: session.id };
  }

  const runtimeSettings = isWhatsAppImageWithSourceUrl(input)
    ? undefined
    : await resolveRuntimeSettings(input.userId, deps);
  if (runtimeSettings === null) {
    await applyRuntimeResolutionFailure(input, deps, session, events);
    return { sessionId: session.id };
  }
  const runnerResult = await deps.runner.run({
    session,
    events: excludeCurrentUserMessage(events, input.messageId),
    message: effectiveMessage,
    ...(input.replyContext !== undefined ? { replyContext: input.replyContext } : {}),
    sourceType: input.sourceType,
    ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
    currentDateTime: now,
    timeZone: runtimeSettings?.timeZone ?? 'UTC',
    ...(runtimeSettings !== undefined ? { runtimeSettings } : {}),
    messageId: input.messageId,
  });
  await applyRunnerResult(input, deps, session, runnerResult, events, 'proposal');

  return { sessionId: session.id };
}

async function resolveRuntimeSettings(
  userId: string,
  deps: HandleIncomingMessageDeps
): Promise<IntexAgentRuntimeSnapshot | null> {
  try {
    const result = await deps.resolveRuntimeSettings(userId);
    if (!result.ok) {
      deps.logger.warn(
        { reason: 'runtime_settings_resolution_failed' },
        'Intex Agent runtime settings resolution failed'
      );
      return null;
    }
    return freezeRuntimeSnapshot(result.value);
  } catch {
    deps.logger.warn(
      { reason: 'runtime_settings_resolution_failed' },
      'Intex Agent runtime settings resolution failed'
    );
    return null;
  }
}

function freezeRuntimeSnapshot(value: IntexAgentRuntimeSettingsV1): IntexAgentRuntimeSnapshot {
  if (value.status === 'available') {
    return Object.freeze({
      status: value.status,
      effectiveModel: value.effectiveModel,
      timeZone: value.timeZone,
      source: value.source,
      explicitModel: value.explicitModel,
      revision: value.revision,
    });
  }
  if (!isIntexAgentModel(value.effectiveModel)) {
    throw new Error('Validated runtime model is not canonical');
  }
  return Object.freeze({
    status: value.status,
    effectiveModel: value.effectiveModel,
    timeZone: value.timeZone,
    source: value.source,
  });
}

async function applyRuntimeResolutionFailure(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  events: readonly IntexAgentSessionEvent[]
): Promise<void> {
  const language = selectReplyLanguage(input, events);
  const reply = RUNTIME_RESOLUTION_FAILURE_REPLIES[language];
  await appendEvent(deps, session, 'agent_fallback', {
    reason: 'runtime_resolution_failed',
    sourceOutcome: 'runtime_resolution',
  });
  await appendEvent(deps, session, 'clarification_requested', {
    message: reply,
    blockerReason: 'not_enough_context',
    suggestedNextStep: FALLBACK_CLARIFICATION_NEXT_STEPS[language],
    fallbackReason: 'runtime_resolution_failed',
  });
  const assistantAt = await appendAssistantMessage(session, deps, reply);
  await deps.sessionRepository.updateSession(session.id, {
    status: 'waiting_for_user',
    lastAssistantMessageAt: assistantAt,
  });
  await publishReply(input, deps, session.id, reply);
}

async function handleConfirmationResponse(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  currentSession: IntexAgentSession | null,
  now: string,
  normalizedUserTimestamp: string,
  directTextConfirmation?: Readonly<{
    decision: 'yes' | 'no';
    events: IntexAgentSessionEvent[];
    pendingConfirmation: PendingConfirmation;
  }>
): Promise<IncomingMessageHandlerResult> {
  if (currentSession === null) {
    const reply = staleConfirmationReply(
      selectIntexAgentReplyLanguage({ currentMessage: messageLanguageInput(input) })
    );
    await deps.replyPublisher.publishReply({
      userId: input.userId,
      message: reply,
      replyToMessageId: input.messageId,
      correlationId: input.messageId,
    });
    return { sessionId: input.messageId };
  }

  const buttonResponse = input.buttonResponse;
  const parsedButton =
    buttonResponse === undefined ? null : parseConfirmationButtonId(buttonResponse.buttonId);
  const events =
    directTextConfirmation?.events ??
    (await deps.sessionRepository.listEvents(currentSession.id, input.userId));

  await appendEvent(deps, currentSession, 'user_message', {
    messageId: input.messageId,
    text: input.text,
    sourceType: input.sourceType,
    ...(buttonResponse !== undefined ? { buttonResponse } : {}),
  });
  await deps.sessionRepository.updateSession(currentSession.id, {
    status: 'active',
    lastUserMessageAt: normalizedUserTimestamp,
  });

  const pendingConfirmation =
    directTextConfirmation?.pendingConfirmation ?? findLatestPendingConfirmation(events);
  const confirmationDecision = directTextConfirmation?.decision ?? parsedButton?.decision;
  const replyLanguage = selectReplyLanguage(input, events);
  if (
    confirmationDecision === undefined ||
    pendingConfirmation === null ||
    (directTextConfirmation === undefined &&
      parsedButton?.confirmationId !== pendingConfirmation.confirmationId)
  ) {
    const reply = staleConfirmationReply(replyLanguage);
    const assistantAt = await appendAssistantMessage(currentSession, deps, reply);
    await deps.sessionRepository.updateSession(currentSession.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, currentSession.id, reply);
    return { sessionId: currentSession.id };
  }

  await appendEvent(deps, currentSession, 'confirmation_resolved', {
    confirmationId: pendingConfirmation.confirmationId,
    resolution: confirmationDecision === 'yes' ? 'accepted' : 'rejected',
    ...(buttonResponse === undefined
      ? {}
      : {
          buttonId: buttonResponse.buttonId,
          buttonTitle: buttonResponse.buttonTitle,
          replyToWamid: buttonResponse.replyToWamid,
        }),
  });

  if (confirmationDecision === 'no') {
    const reply = REJECTED_CONFIRMATION_REPLIES[replyLanguage];
    const assistantAt = await appendAssistantMessage(currentSession, deps, reply);
    await deps.sessionRepository.updateSession(currentSession.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, currentSession.id, reply);
    return { sessionId: currentSession.id };
  }

  let executionResult: IntexAgentRunnerResult;
  try {
    const confirmedInput = {
      session: currentSession,
      events: await deps.sessionRepository.listEvents(currentSession.id, input.userId),
      currentDateTime: now,
      messageId: input.messageId,
    };
    executionResult = await deps.runner.executeConfirmed(
      pendingConfirmation.operations === undefined
        ? {
            ...confirmedInput,
            toolName: pendingConfirmation.toolName,
            toolArgs: pendingConfirmation.toolArgs,
          }
        : { ...confirmedInput, operations: pendingConfirmation.operations }
    );
    if (
      pendingConfirmation.operations !== undefined &&
      executionResult.outcome === 'completed' &&
      executionResult.operationResults === undefined &&
      executionResult.toolName === undefined
    ) {
      executionResult = {
        ...executionResult,
        toolName: pendingConfirmation.toolName,
      };
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown tool execution error');
    executionResult = {
      outcome: 'tool_failed',
      reply: `${TOOL_EXECUTION_FAILURE_PREFIX[replyLanguage]}${errorMessage}${TOOL_EXECUTION_FAILURE_SUFFIX[replyLanguage]}`,
      toolName: pendingConfirmation.toolName,
      error: errorMessage,
    };
  }

  await applyRunnerResult(input, deps, currentSession, executionResult, events, 'confirmed');
  return { sessionId: currentSession.id };
}

async function closePreviousSessionIfNeeded(
  decision: SessionTransitionDecision,
  deps: HandleIncomingMessageDeps
): Promise<void> {
  if (decision.action !== 'start_new' || decision.closeCurrentSession === undefined) {
    return;
  }

  const close = decision.closeCurrentSession;
  const session = await deps.sessionRepository.updateSession(close.id, {
    status: close.status,
    endedAt: close.endedAt,
    endReason: close.endReason,
  });
  await appendEvent(deps, session, 'session_closed', {
    status: close.status,
    reason: close.endReason,
  }, close.endedAt);
}

async function resolveSession(
  decision: SessionTransitionDecision,
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  normalizedUserTimestamp: string
): Promise<IntexAgentSession> {
  if (decision.action === 'continue') {
    return decision.session;
  }

  const startedAt = deps.clock.now();
  const session: IntexAgentSession = await deps.sessionRepository.createSession({
    id: deps.ids.sessionId(),
    userId: input.userId,
    channel: 'whatsapp',
    status: 'active',
    startedAt,
    lastUserMessageAt: normalizedUserTimestamp,
    startReason: decision.startReason,
  });
  await appendEvent(deps, session, 'session_started', {
    reason: decision.startReason,
    explicit: decision.isExplicitNewSession,
  }, startedAt);
  return session;
}

async function applyRunnerResult(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  runnerResult: IntexAgentRunnerResult,
  languageEvents: readonly IntexAgentSessionEvent[] = [],
  phase: 'proposal' | 'confirmed' = 'proposal'
): Promise<void> {
  if (
    phase === 'proposal' &&
    runnerResult.outcome === 'completed' &&
    runnerResult.toolName === 'create_calendar_event'
  ) {
    const language = selectReplyLanguage(input, languageEvents);
    await applyRunnerResult(
      input,
      deps,
      session,
      {
        outcome: 'needs_clarification',
        reply: CALENDAR_PROPOSAL_BYPASS_REPLIES[language],
        blockerReason: 'not_enough_context',
        candidateIntents: ['create_calendar_event'],
        suggestedNextStep:
          language === 'pl'
            ? 'Podaj ponownie tytuł, datę, początek i koniec wydarzenia.'
            : 'Restate the event title, date, start, and end.',
        fallbackReason: 'tool_result_mismatch',
        fallbackSourceOutcome: 'completed',
      },
      languageEvents,
      phase
    );
    return;
  }
  if (runnerResult.outcome === 'no_action') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'needs_clarification') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendAgentFallbackIfNeeded(deps, session, runnerResult, 'needs_clarification');
    await appendEvent(deps, session, 'clarification_requested', {
      message: reply,
      ...runnerMetadataPayload(runnerResult),
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'needs_confirmation') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    for (const completion of runnerResult.supportingToolCompletions ?? []) {
      await appendEvent(deps, session, 'tool_call_completed', {
        toolName: completion.toolName,
        result: completion.result,
        ...(completion.toolSelection !== undefined
          ? { toolSelection: completion.toolSelection }
          : {}),
      });
    }
    const confirmationId = deps.ids.confirmationId();
    await appendEvent(deps, session, 'confirmation_requested', {
      confirmationId,
      toolName: runnerResult.toolName,
      toolArgs: runnerResult.toolArgs,
      ...(runnerResult.operations !== undefined ? { operations: runnerResult.operations } : {}),
      message: reply,
      sourceMessageId: input.messageId,
      ...(runnerResult.toolSelection !== undefined
        ? { toolSelection: runnerResult.toolSelection }
        : {}),
      ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      activeTool: runnerResult.toolName,
      ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
    });
    await publishReply(
      input,
      deps,
      session.id,
      reply,
      undefined,
      confirmationButtons(confirmationId, selectReplyLanguage(input, languageEvents))
    );
    return;
  }

  if (runnerResult.outcome === 'tool_failed') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendEvent(deps, session, 'tool_call_failed', {
      toolName: runnerResult.toolName,
      error: runnerResult.error,
      ...(runnerResult.errorCategory !== undefined
        ? { errorCategory: runnerResult.errorCategory }
        : {}),
      ...(runnerResult.isRetryable !== undefined ? { isRetryable: runnerResult.isRetryable } : {}),
      ...(runnerResult.attemptedAction !== undefined
        ? { attemptedAction: runnerResult.attemptedAction }
        : {}),
      ...(runnerResult.toolSelection !== undefined
        ? { toolSelection: runnerResult.toolSelection }
        : {}),
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      activeTool: runnerResult.toolName,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'unsupported') {
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    await appendAgentFallbackIfNeeded(deps, session, runnerResult, 'unsupported');
    await appendEvent(deps, session, 'unsupported_request', {
      message: runnerResult.reply,
      ...runnerMetadataPayload(runnerResult),
    });
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      summary: summarizeUserMessage(input.text),
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.outcome === 'tool_selection_rejected') {
    throw new Error('Matrix corpus tool-selection results require the isolated test handler');
  }

  if (runnerResult.operationResults !== undefined) {
    for (const operation of runnerResult.operationResults) {
      await appendEvent(
        deps,
        session,
        operation.status === 'completed' ? 'tool_call_completed' : 'tool_call_failed',
        operation.status === 'completed'
          ? {
              toolName: operation.toolName,
              ...(operation.toolResult !== undefined ? { result: operation.toolResult } : {}),
            }
          : { toolName: operation.toolName, error: operation.error ?? 'Unknown tool execution error' }
      );
    }
    const reply = stripDuplicateSessionPrefix(runnerResult.reply);
    const assistantAt = await appendAssistantMessage(session, deps, reply);
    await deps.sessionRepository.updateSession(session.id, {
      status: 'waiting_for_user',
      lastAssistantMessageAt: assistantAt,
      activeTool: null,
    });
    await publishReply(input, deps, session.id, reply);
    return;
  }

  if (runnerResult.toolName === undefined) {
    await applyRunnerResult(
      input,
      deps,
      session,
      fallbackClarificationResult(input, languageEvents, 'tool_result_mismatch'),
      languageEvents
    );
    return;
  }

  const reply = completedReplyWithFollowUp(
    stripDuplicateSessionPrefix(runnerResult.reply),
    runnerResult.toolName,
    selectReplyLanguage(input, languageEvents)
  );
  await appendEvent(deps, session, 'tool_call_completed', {
    toolName: runnerResult.toolName,
    ...(runnerResult.toolResult !== undefined ? { result: runnerResult.toolResult } : {}),
    ...(runnerResult.toolSelection !== undefined
      ? { toolSelection: runnerResult.toolSelection }
      : {}),
  });
  const assistantAt = await appendAssistantMessage(session, deps, reply);
  await deps.sessionRepository.updateSession(session.id, {
    status: 'waiting_for_user',
    lastAssistantMessageAt: assistantAt,
    activeTool: null,
    ...(runnerResult.summary !== undefined ? { summary: runnerResult.summary } : {}),
  });
  await publishReply(input, deps, session.id, reply, runnerResult.ctaUrl);
}

function completedReplyWithFollowUp(
  reply: string,
  toolName: IntexAgentToolName,
  replyLanguage: IntexAgentReplyLanguage
): string {
  if (!isPreferenceMutationToolName(toolName)) {
    return reply;
  }
  if (/[?？]\s*$/u.test(reply)) {
    return reply;
  }
  return `${reply.replace(/[.。]\s*$/u, '')}. ${COMPLETED_FOLLOW_UP_PROMPTS[replyLanguage]}`;
}

function isPreferenceMutationToolName(toolName: IntexAgentToolName): boolean {
  return (
    toolName === 'add_user_preference' ||
    toolName === 'update_user_preference' ||
    toolName === 'delete_user_preference'
  );
}

async function appendAssistantMessage(
  session: IntexAgentSession,
  deps: HandleIncomingMessageDeps,
  text: string
): Promise<string> {
  return await appendEvent(deps, session, 'assistant_message', { text });
}

async function appendEvent(
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  type: IntexAgentSessionEventType,
  payload: Record<string, unknown>,
  createdAt = deps.clock.now()
): Promise<string> {
  await deps.sessionRepository.appendEvent({
    id: deps.ids.eventId(),
    sessionId: session.id,
    userId: session.userId,
    type,
    payload,
    createdAt,
  });
  return createdAt;
}

async function publishReply(
  input: IntexIncomingMessage,
  deps: HandleIncomingMessageDeps,
  sessionId: string,
  message: string,
  ctaUrl?: {
    displayText: string;
    url: string;
  },
  buttons?: WhatsAppInteractiveButton[]
): Promise<void> {
  await deps.replyPublisher.publishReply({
    userId: input.userId,
    message,
    replyToMessageId: input.messageId,
    correlationId: sessionId,
    ...(ctaUrl !== undefined ? { ctaUrl } : {}),
    ...(buttons !== undefined ? { buttons } : {}),
  });
}

function newSessionReadyText(
  input: IntexIncomingMessage,
  events: readonly IntexAgentSessionEvent[]
): string {
  return buildNewSessionReadyText(selectReplyLanguage(input, events));
}

function stripDuplicateSessionPrefix(text: string): string {
  return text
    .replace(/^(Previous session (?:superseded|expired)\. )?New session started\.\s*/i, '')
    .trimStart();
}

function runnerMetadataPayload(
  runnerResult: Extract<
    IntexAgentRunnerResult,
    { outcome: 'needs_clarification' } | { outcome: 'unsupported' }
  >
): Record<string, unknown> {
  return {
    ...(runnerResult.blockerReason !== undefined
      ? { blockerReason: runnerResult.blockerReason }
      : {}),
    ...(runnerResult.missingFields !== undefined
      ? { missingFields: runnerResult.missingFields }
      : {}),
    ...(runnerResult.candidateIntents !== undefined
      ? { candidateIntents: runnerResult.candidateIntents }
      : {}),
    ...(runnerResult.suggestedNextStep !== undefined
      ? { suggestedNextStep: runnerResult.suggestedNextStep }
      : {}),
    ...(runnerResult.fallbackReason !== undefined
      ? { fallbackReason: runnerResult.fallbackReason }
      : {}),
    ...(runnerResult.outcome === 'needs_clarification' &&
    runnerResult.clarification !== undefined
      ? { clarification: runnerResult.clarification }
      : {}),
    ...(runnerResult.outcome === 'needs_clarification' &&
    runnerResult.calendarEventDraft !== undefined
      ? { calendarEventDraft: runnerResult.calendarEventDraft }
      : {}),
    ...(runnerResult.outcome === 'needs_clarification' && runnerResult.toolSelection !== undefined
      ? { toolSelection: runnerResult.toolSelection }
      : {}),
  };
}

function summarizeUserMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

async function appendAgentFallbackIfNeeded(
  deps: HandleIncomingMessageDeps,
  session: IntexAgentSession,
  runnerResult: Extract<
    IntexAgentRunnerResult,
    { outcome: 'needs_clarification' } | { outcome: 'unsupported' }
  >,
  sourceOutcome: 'needs_clarification' | 'unsupported'
): Promise<void> {
  if (runnerResult.fallbackReason === undefined) {
    return;
  }

  await appendEvent(deps, session, 'agent_fallback', {
    reason: runnerResult.fallbackReason,
    sourceOutcome: runnerResult.fallbackSourceOutcome ?? sourceOutcome,
  });
}

function fallbackClarificationResult(
  input: IntexIncomingMessage,
  events: readonly IntexAgentSessionEvent[],
  fallbackReason: Extract<
    IntexAgentFallbackReason,
    'runner_output_malformed' | 'tool_result_mismatch' | 'llm_call_failed'
  >
): Extract<IntexAgentRunnerResult, { outcome: 'needs_clarification' }> {
  const language = selectReplyLanguage(input, events);
  return {
    outcome: 'needs_clarification',
    reply: FALLBACK_CLARIFICATION_REPLIES[language],
    blockerReason: 'not_enough_context',
    suggestedNextStep: FALLBACK_CLARIFICATION_NEXT_STEPS[language],
    fallbackReason,
    fallbackSourceOutcome: 'completed',
  };
}

const FALLBACK_CLARIFICATION_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'What would you like me to do with this?',
  pl: 'Co mam z tym zrobić?',
};

const RUNTIME_RESOLUTION_FAILURE_REPLIES: Record<IntexAgentReplyLanguage, string> = {
  en: 'I could not process that request right now. Please restate what you want me to do.',
  pl: 'Nie mogłem teraz przetworzyć tej prośby. Napisz proszę jeszcze raz, co mam zrobić.',
};

const FALLBACK_CLARIFICATION_NEXT_STEPS: Record<IntexAgentReplyLanguage, string> = {
  en: 'Ask the user to restate the action.',
  pl: 'Poproś użytkownika o doprecyzowanie akcji.',
};

interface ParsedConfirmationButton {
  confirmationId: string;
  decision: 'yes' | 'no';
}

interface PendingConfirmation {
  confirmationId: string;
  toolName: IntexAgentToolName;
  toolArgs: Record<string, unknown>;
  operations?: readonly IntexAgentConfirmedOperation[];
}

function confirmationButtons(
  confirmationId: string,
  replyLanguage: IntexAgentReplyLanguage
): WhatsAppInteractiveButton[] {
  const labels = CONFIRMATION_BUTTON_LABELS[replyLanguage];
  return [
    {
      type: 'reply',
      reply: {
        id: `intex_confirm:${confirmationId}:yes`,
        title: labels.yes,
      },
    },
    {
      type: 'reply',
      reply: {
        id: `intex_confirm:${confirmationId}:no`,
        title: labels.no,
      },
    },
  ];
}

function parseConfirmationButtonId(buttonId: string): ParsedConfirmationButton | null {
  const match = /^intex_confirm:([^:]+):(yes|no)$/u.exec(buttonId);
  if (match === null) {
    return null;
  }
  const confirmationId = match[1];
  const decision = match[2];
  /* v8 ignore start -- schema: successful confirmation button regex cannot omit id or yes/no decision captures @preserve */
  if (confirmationId === undefined || (decision !== 'yes' && decision !== 'no')) {
    return null;
  }
  /* v8 ignore stop @preserve */
  return {
    confirmationId,
    decision,
  };
}

function parsePlainTextConfirmationDecision(value: string): 'yes' | 'no' | null {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[.!]+$/u, '')
    .trim();
  if (normalized === 'tak' || normalized === 'yes') return 'yes';
  if (normalized === 'nie' || normalized === 'no') return 'no';
  return null;
}

function findLatestPendingConfirmation(
  events: IntexAgentSessionEvent[]
): PendingConfirmation | null {
  const resolvedConfirmationIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'confirmation_resolved') {
      continue;
    }
    const confirmationId = event.payload['confirmationId'];
    if (typeof confirmationId === 'string') {
      resolvedConfirmationIds.add(confirmationId);
    }
  }

  for (const event of [...events].reverse()) {
    if (event.type !== 'confirmation_requested') {
      continue;
    }
    const confirmationId = event.payload['confirmationId'];
    const toolName = event.payload['toolName'];
    const toolArgs = event.payload['toolArgs'];
    const hasOperations = Object.hasOwn(event.payload, 'operations');
    const operations = hasOperations
      ? parseConfirmedOperations(event.payload['operations'])
      : undefined;
    if (
      typeof confirmationId !== 'string' ||
      resolvedConfirmationIds.has(confirmationId) ||
      (hasOperations && operations === undefined) ||
      (!hasOperations && (!isConfirmableToolName(toolName) || !isRecord(toolArgs)))
    ) {
      continue;
    }
    const firstOperation = operations?.[0];
    return {
      confirmationId,
      toolName: firstOperation?.toolName ?? (toolName as IntexAgentToolName),
      toolArgs: firstOperation?.toolArgs ?? (toolArgs as Record<string, unknown>),
      ...(operations !== undefined ? { operations } : {}),
    };
  }

  return null;
}

function findLatestDirectTextConfirmation(
  events: IntexAgentSessionEvent[]
): PendingConfirmation | null {
  const latestRequestedEvent = [...events]
    .reverse()
    .find((event) => event.type === 'confirmation_requested');
  const latestConfirmationId = latestRequestedEvent?.payload['confirmationId'];
  if (typeof latestConfirmationId !== 'string') return null;
  const pendingConfirmation = findLatestPendingConfirmation(events);
  return pendingConfirmation?.confirmationId === latestConfirmationId
    ? pendingConfirmation
    : null;
}

function parseConfirmedOperations(value: unknown): IntexAgentConfirmedOperation[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < CONFIRMED_CALENDAR_UPDATE_BATCH_MIN_OPERATIONS ||
    value.length > CONFIRMED_CALENDAR_UPDATE_BATCH_MAX_OPERATIONS
  ) {
    return undefined;
  }
  const operations: IntexAgentConfirmedOperation[] = [];
  const eventIds = new Set<string>();
  for (const operation of value) {
    if (
      !isRecord(operation) ||
      !hasOnlyKeys(operation, CONFIRMED_CALENDAR_UPDATE_OPERATION_KEYS)
    ) {
      return undefined;
    }
    const toolName = operation['toolName'];
    const toolArgs = parseConfirmedCalendarUpdateArgs(operation['toolArgs']);
    if (toolName !== 'update_calendar_event' || toolArgs === undefined) return undefined;
    const eventId = toolArgs['eventId'] as string;
    const eventIdentity = eventId.trim();
    if (eventIds.has(eventIdentity)) {
      return undefined;
    }
    eventIds.add(eventIdentity);
    if (Object.hasOwn(operation, 'toolSelection')) {
      const toolSelection = parseConfirmedToolSelection(operation['toolSelection']);
      if (toolSelection === undefined) return undefined;
      operations.push({ toolName, toolArgs, toolSelection });
      continue;
    }
    operations.push({ toolName, toolArgs });
  }
  return operations;
}

function parseConfirmedCalendarUpdateArgs(
  value: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIRMED_CALENDAR_UPDATE_ARG_KEYS)) {
    return undefined;
  }
  if (
    !isNonBlankString(value['eventId']) ||
    !isNonBlankString(value['eventSummary']) ||
    !isNonBlankString(value['calendarId']) ||
    !isNonBlankString(value['expectedEtag']) ||
    !isConfirmedCalendarDateTime(value['eventStart']) ||
    !isConfirmedCalendarDateTime(value['eventEnd']) ||
    !isConfirmedCalendarUpdateChanges(value['changes'])
  ) {
    return undefined;
  }
  return value;
}

function isConfirmedCalendarDateTime(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIRMED_CALENDAR_DATE_TIME_KEYS)) {
    return false;
  }
  const parsed = calendarEventDateTimeSchema.safeParse(value);
  if (!parsed.success) return false;
  const hasDate = isNonBlankString(parsed.data.date);
  const hasDateTime = isNonBlankString(parsed.data.dateTime);
  return (
    hasDate !== hasDateTime &&
    (parsed.data.timeZone === undefined || isNonBlankString(parsed.data.timeZone))
  );
}

function isConfirmedCalendarUpdateChanges(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const normalized = {
    ...value,
    ...(Object.hasOwn(value, 'attendeesToAdd')
      ? { attendeesToAdd: normalizeConfirmedAttendees(value['attendeesToAdd']) }
      : {}),
    ...(Object.hasOwn(value, 'attendeesToRemove')
      ? { attendeesToRemove: normalizeConfirmedAttendees(value['attendeesToRemove']) }
      : {}),
  };
  return calendarUpdateEventChangesSchema.safeParse(normalized).success;
}

function normalizeConfirmedAttendees(value: unknown): unknown {
  return Array.isArray(value)
    ? (value as unknown[]).map((email: unknown) => ({ email }))
    : value;
}

function parseConfirmedToolSelection(
  value: unknown
): IntexAgentToolSelectionMetadata | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIRMED_TOOL_SELECTION_KEYS)) {
    return undefined;
  }
  const turnIndex = value['turnIndex'];
  const ordinal = value['ordinal'];
  if (
    typeof turnIndex !== 'number' ||
    !Number.isInteger(turnIndex) ||
    turnIndex < 0 ||
    typeof ordinal !== 'number' ||
    !Number.isInteger(ordinal) ||
    ordinal < 1
  ) {
    return undefined;
  }
  return { turnIndex, ordinal };
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

async function supersedePendingConfirmationIfNeeded(
  session: IntexAgentSession,
  deps: HandleIncomingMessageDeps,
  events: IntexAgentSessionEvent[]
): Promise<void> {
  const pendingConfirmation = findLatestPendingConfirmation(events);
  if (pendingConfirmation === null) {
    return;
  }

  await appendEvent(deps, session, 'confirmation_resolved', {
    confirmationId: pendingConfirmation.confirmationId,
    resolution: 'superseded',
  });
}

function staleConfirmationReply(replyLanguage: IntexAgentReplyLanguage): string {
  return STALE_CONFIRMATION_REPLIES[replyLanguage];
}

function isConfirmableToolName(value: unknown): value is IntexAgentToolName {
  return typeof value === 'string' && CONFIRMABLE_TOOL_NAMES.has(value as IntexAgentToolName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildMissingLinkReply(message: string, events: IntexAgentSessionEvent[]): string | null {
  if (!isMissingLinkFollowUp(message)) {
    return null;
  }
  const replyLanguage = selectIntexAgentReplyLanguage({
    currentMessage: { text: message },
    priorMessages: languageMessagesFromEvents(events),
  });

  const resourceUrl = findLastToolResourceUrl(events);
  if (resourceUrl === null) {
    return MISSING_LINK_REPLIES.missing[replyLanguage];
  }

  return `${MISSING_LINK_REPLIES.prefix[replyLanguage]}${resourceUrl}`;
}

function selectReplyLanguage(
  input: IntexIncomingMessage,
  events: readonly IntexAgentSessionEvent[]
): IntexAgentReplyLanguage {
  return selectIntexAgentReplyLanguage({
    currentMessage: messageLanguageInput(input),
    priorMessages: languageMessagesFromEvents(events),
  });
}

function messageLanguageInput(input: IntexIncomingMessage): IntexAgentLanguageMessage {
  const languageHint =
    input.buttonResponse === undefined
      ? undefined
      : confirmationButtonLanguage(input.buttonResponse.buttonTitle);
  return {
    text:
      input.text.trim() !== ''
        ? input.text
        : input.buttonResponse?.buttonTitle ?? input.text,
    sourceType: input.sourceType,
    ...(input.sourceUrl !== undefined ? { hasSourceUrl: true } : {}),
    ...(languageHint !== undefined ? { languageHint } : {}),
  };
}

function confirmationButtonLanguage(buttonTitle: string): IntexAgentReplyLanguage | undefined {
  const normalized = buttonTitle.trim().toLocaleLowerCase('pl-PL');
  if (normalized === 'tak' || normalized === 'nie') {
    return 'pl';
  }
  if (normalized === 'yes' || normalized === 'no') {
    return 'en';
  }
  return undefined;
}

function languageMessagesFromEvents(
  events: readonly IntexAgentSessionEvent[]
): IntexAgentLanguageMessage[] {
  const messages: IntexAgentLanguageMessage[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'user_message') {
      continue;
    }
    const text = event.payload['text'];
    if (typeof text !== 'string') {
      continue;
    }
    messages.push({
      text,
      ...(typeof event.payload['sourceType'] === 'string'
        ? { sourceType: event.payload['sourceType'] }
        : {}),
      ...(event.payload['hasSourceUrl'] === true ? { hasSourceUrl: true } : {}),
    });
  }
  return messages;
}

function isMissingLinkFollowUp(message: string): boolean {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    normalized.includes('link') &&
    (normalized.includes('nie dost') ||
      normalized.includes('brak') ||
      normalized.includes('no link') ||
      normalized.includes('did not get') ||
      normalized.includes("didn't get"))
  );
}

function findLastToolResourceUrl(events: IntexAgentSessionEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool_call_completed') {
      continue;
    }

    const result = event.payload['result'];
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      continue;
    }

    const record = result as Record<string, unknown>;
    const resourceUrl = record['resourceUrl'] ?? record['htmlLink'] ?? record['url'];
    if (typeof resourceUrl === 'string' && resourceUrl.trim() !== '') {
      return resourceUrl;
    }
  }

  return null;
}

function excludeCurrentUserMessage(
  events: IntexAgentSessionEvent[],
  messageId: string
): IntexAgentSessionEvent[] {
  return events.filter(
    (event) => event.type !== 'user_message' || event.payload['messageId'] !== messageId
  );
}

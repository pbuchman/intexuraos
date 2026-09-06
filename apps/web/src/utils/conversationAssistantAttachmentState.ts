import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantContextAttachmentError,
} from '@/types';

export type ConversationAssistantAttachmentDto = ConversationAssistantContextAttachment;
export type ConversationAssistantAttachmentPreparationError =
  ConversationAssistantContextAttachmentError;

export interface ConversationAssistantNewerObservation {
  attachmentId: string;
  capturedAt: string;
  newerAvailableCount: number;
  newerAvailableCorrectionCount: number;
}

export type ConversationAssistantAttachmentFailure =
  | {
      code: 'ATTACHMENT_TOO_LARGE';
      message: string;
      blocking: true;
    }
  | {
      code: 'PREPARATION_FAILED';
      message: string;
      blocking: false;
    }
  | {
      code: 'CONTEXT_WINDOW_EXCEEDED';
      message: 'This update is too large to include in one question.';
      blocking: true;
    };

interface AttachmentStateWithValue {
  sessionId: string;
  attachment: ConversationAssistantAttachmentDto;
}

export type ConversationAssistantAttachmentState =
  | { phase: 'idle'; sessionId: string }
  | {
      phase: 'preparing_intent';
      sessionId: string;
      requestId: string;
      replacesAttachmentId?: string;
    }
  | { phase: 'restoring'; sessionId: string; attachmentId?: string }
  | {
      phase: 'restore_failed';
      sessionId: string;
      attachmentId: string;
      message: string;
    }
  | { phase: 'missing'; sessionId: string; attachmentId: string }
  | ({ phase: 'preparing' } & AttachmentStateWithValue)
  | ({
      phase: 'ready';
      dismissedNewerObservation?: ConversationAssistantNewerObservation;
    } & AttachmentStateWithValue)
  | ({ phase: 'newer_available' } & AttachmentStateWithValue)
  | ({ phase: 'failed'; failure: ConversationAssistantAttachmentFailure } &
      AttachmentStateWithValue)
  | ({ phase: 'expired' } & AttachmentStateWithValue)
  | ({ phase: 'stale' } & AttachmentStateWithValue)
  | ({ phase: 'recapture_required' } & AttachmentStateWithValue)
  | ({ phase: 'consumed_elsewhere' } & AttachmentStateWithValue);

export type ConversationAssistantAttachmentAction =
  | {
      type: 'begin_preparing_intent';
      sessionId: string;
      requestId: string;
      replacesAttachmentId?: string;
    }
  | {
      type: 'begin_restoring';
      sessionId: string;
      attachmentId?: string;
    }
  | {
      type: 'restore_failed';
      sessionId: string;
      attachmentId: string;
      message: string;
    }
  | {
      type: 'restore_missing';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'track_attachment';
      sessionId?: string;
      attachment: ConversationAssistantAttachmentDto;
    }
  | {
      type: 'attachment_status_received';
      sessionId?: string;
      attachment: ConversationAssistantAttachmentDto;
    }
  | {
      type: 'keep_current_snapshot';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'hard_limit_rejected';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'recapture_required';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'remove';
      sessionId: string;
      attachmentId: string;
    }
  | {
      type: 'reset';
      sessionId: string;
    };

const DEFAULT_PREPARATION_FAILURE: ConversationAssistantAttachmentPreparationError = {
  code: 'PREPARATION_FAILED',
  message: 'The context attachment could not be prepared',
};

const HARD_LIMIT_FAILURE: ConversationAssistantAttachmentFailure = {
  code: 'CONTEXT_WINDOW_EXCEEDED',
  message: 'This update is too large to include in one question.',
  blocking: true,
};

export function createConversationAssistantAttachmentState(
  sessionId: string
): ConversationAssistantAttachmentState {
  return { phase: 'idle', sessionId };
}

function getTrackedAttachment(
  state: ConversationAssistantAttachmentState
): ConversationAssistantAttachmentDto | null {
  return state.phase === 'idle' ||
    state.phase === 'preparing_intent' ||
    state.phase === 'restoring' ||
    state.phase === 'restore_failed' ||
    state.phase === 'missing'
    ? null
    : state.attachment;
}

function getTrackedAttachmentId(state: ConversationAssistantAttachmentState): string | null {
  if (state.phase === 'idle') return null;
  if (state.phase === 'preparing_intent') return null;
  if (state.phase === 'restoring') return state.attachmentId ?? null;
  if (state.phase === 'restore_failed' || state.phase === 'missing') {
    return state.attachmentId;
  }
  return state.attachment.id;
}

function toNewerObservation(
  attachment: ConversationAssistantAttachmentDto
): ConversationAssistantNewerObservation {
  return {
    attachmentId: attachment.id,
    capturedAt: attachment.capturedAt,
    newerAvailableCount: attachment.newerAvailableCount,
    newerAvailableCorrectionCount: attachment.newerAvailableCorrectionCount,
  };
}

function isSameNewerObservation(
  left: ConversationAssistantNewerObservation | undefined,
  right: ConversationAssistantNewerObservation
): boolean {
  return (
    left?.attachmentId === right.attachmentId &&
    left.capturedAt === right.capturedAt &&
    left.newerAvailableCount === right.newerAvailableCount &&
    left.newerAvailableCorrectionCount === right.newerAvailableCorrectionCount
  );
}

function mapAttachmentToState(
  state: ConversationAssistantAttachmentState,
  incomingAttachment: ConversationAssistantAttachmentDto
): ConversationAssistantAttachmentState {
  const attachment = incomingAttachment;
  const sessionId = state.sessionId;

  if (attachment.status === 'committed') {
    return { phase: 'consumed_elsewhere', sessionId, attachment };
  }
  if (attachment.compatibility === 'stale') return { phase: 'stale', sessionId, attachment };

  if (
    state.phase === 'failed' &&
    state.failure.code === 'CONTEXT_WINDOW_EXCEEDED' &&
    state.attachment.id === attachment.id &&
    attachment.status === 'ready'
  ) {
    return { ...state, attachment };
  }

  switch (attachment.status) {
    case 'preparing':
      return { phase: 'preparing', sessionId, attachment };
    case 'ready': {
      const observation = toNewerObservation(attachment);
      const hasNewerContext =
        attachment.newerAvailableCount > 0 ||
        attachment.newerAvailableCorrectionCount > 0;
      const dismissed =
        state.phase === 'ready' ? state.dismissedNewerObservation : undefined;
      const observationIsDismissed = isSameNewerObservation(dismissed, observation);
      if (hasNewerContext && !observationIsDismissed) {
        return { phase: 'newer_available', sessionId, attachment };
      }
      return {
        phase: 'ready',
        sessionId,
        attachment,
        ...(observationIsDismissed && dismissed !== undefined
          ? { dismissedNewerObservation: dismissed }
          : {}),
      };
    }
    case 'failed': {
      const preparationError = attachment.error ?? DEFAULT_PREPARATION_FAILURE;
      if (preparationError.code === 'ATTACHMENT_TOO_LARGE') {
        return {
          phase: 'failed',
          sessionId,
          attachment,
          failure: {
            code: 'ATTACHMENT_TOO_LARGE',
            message: preparationError.message,
            blocking: true,
          },
        };
      }
      return {
        phase: 'failed',
        sessionId,
        attachment,
        failure: {
          code: 'PREPARATION_FAILED',
          message: preparationError.message,
          blocking: false,
        },
      };
    }
    case 'expired':
      return { phase: 'expired', sessionId, attachment };
  }
}

function acceptsStatusResponse(
  state: ConversationAssistantAttachmentState,
  sessionId: string | undefined,
  attachment: ConversationAssistantAttachmentDto
): boolean {
  return (
    (sessionId ?? state.sessionId) === state.sessionId &&
    getTrackedAttachmentId(state) === attachment.id
  );
}

export function reduceConversationAssistantAttachmentState(
  state: ConversationAssistantAttachmentState,
  action: ConversationAssistantAttachmentAction
): ConversationAssistantAttachmentState {
  switch (action.type) {
    case 'begin_preparing_intent':
      return action.sessionId === state.sessionId
        ? {
            phase: 'preparing_intent',
            sessionId: state.sessionId,
            requestId: action.requestId,
            ...(action.replacesAttachmentId === undefined
              ? {}
              : { replacesAttachmentId: action.replacesAttachmentId }),
          }
        : state;
    case 'begin_restoring':
      return action.sessionId === state.sessionId
        ? {
            phase: 'restoring',
            sessionId: state.sessionId,
            ...(action.attachmentId === undefined
              ? {}
              : { attachmentId: action.attachmentId }),
          }
        : state;
    case 'restore_failed':
      return action.sessionId === state.sessionId &&
        getTrackedAttachmentId(state) === action.attachmentId
        ? {
            phase: 'restore_failed',
            sessionId: state.sessionId,
            attachmentId: action.attachmentId,
            message: action.message,
          }
        : state;
    case 'restore_missing':
      return action.sessionId === state.sessionId &&
        getTrackedAttachmentId(state) === action.attachmentId
        ? {
            phase: 'missing',
            sessionId: state.sessionId,
            attachmentId: action.attachmentId,
          }
        : state;
    case 'track_attachment':
      return (action.sessionId ?? state.sessionId) === state.sessionId
        ? mapAttachmentToState(state, action.attachment)
        : state;
    case 'attachment_status_received':
      return acceptsStatusResponse(state, action.sessionId, action.attachment)
        ? mapAttachmentToState(state, action.attachment)
        : state;
    case 'keep_current_snapshot':
      if (
        state.phase !== 'newer_available' ||
        action.sessionId !== state.sessionId ||
        action.attachmentId !== state.attachment.id
      ) {
        return state;
      }
      return {
        phase: 'ready',
        sessionId: state.sessionId,
        attachment: state.attachment,
        dismissedNewerObservation: toNewerObservation(state.attachment),
      };
    case 'hard_limit_rejected': {
      const attachment = getTrackedAttachment(state);
      if (
        action.sessionId !== state.sessionId ||
        attachment?.id !== action.attachmentId ||
        attachment.status !== 'ready'
      ) {
        return state;
      }
      return {
        phase: 'failed',
        sessionId: state.sessionId,
        attachment,
        failure: HARD_LIMIT_FAILURE,
      };
    }
    case 'recapture_required': {
      const attachment = getTrackedAttachment(state);
      if (
        action.sessionId !== state.sessionId ||
        attachment?.id !== action.attachmentId
      ) {
        return state;
      }
      return {
        phase: 'recapture_required',
        sessionId: state.sessionId,
        attachment,
      };
    }
    case 'remove':
      return action.sessionId === state.sessionId &&
        getTrackedAttachmentId(state) === action.attachmentId
        ? { phase: 'idle', sessionId: state.sessionId }
        : state;
    case 'reset':
      return { phase: 'idle', sessionId: action.sessionId };
  }
}

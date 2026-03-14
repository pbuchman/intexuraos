import { vi } from 'vitest';
import type { Services } from '../../services.js';

export function createFakeServices(overrides: Partial<Services> = {}): Services {
  return {
    actionRepository: {
      getById: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      listByUserId: vi.fn(),
      listByStatus: vi.fn(),
      updateStatusIf: vi.fn(),
    },
    actionTransitionRepository: {
      save: vi.fn(),
      listByActionId: vi.fn(),
    },
    actionServiceClient: {
      createAction: vi.fn(),
    },
    researchServiceClient: {
      processAction: vi.fn(),
    },
    notificationSender: {
      send: vi.fn(),
    },
    commandsAgentClient: {
      reclassify: vi.fn(),
    },
    todosServiceClient: {
      processAction: vi.fn(),
    },
    notesServiceClient: {
      processAction: vi.fn(),
    },
    bookmarksServiceClient: {
      processAction: vi.fn(),
      forceRefreshBookmark: vi.fn(),
    },
    calendarServiceClient: {
      processAction: vi.fn(),
      getPreview: vi.fn(),
      generatePreview: vi.fn(),
    },
    linearAgentClient: {
      processAction: vi.fn(),
    },
    codeAgentClient: {
      processAction: vi.fn(),
      cancelTask: vi.fn(),
    },
    actionEventPublisher: {
      publish: vi.fn(),
    },
    whatsappPublisher: {
      publish: vi.fn(),
    },
    approvalMessageRepository: {
      save: vi.fn(),
      findByWamid: vi.fn(),
      findByActionId: vi.fn(),
    },
    userServiceClient: {
      getUser: vi.fn(),
      getUserSettings: vi.fn(),
      resolveModel: vi.fn(),
    },
    handleResearchActionUseCase: { execute: vi.fn() },
    handleTodoActionUseCase: { execute: vi.fn() },
    handleNoteActionUseCase: { execute: vi.fn() },
    handleLinkActionUseCase: { execute: vi.fn() },
    handleCalendarActionUseCase: { execute: vi.fn() },
    handleLinearActionUseCase: { execute: vi.fn() },
    handleCodeActionUseCase: { execute: vi.fn() },
    executeResearchActionUseCase: vi.fn(),
    executeTodoActionUseCase: vi.fn(),
    executeNoteActionUseCase: vi.fn(),
    executeLinkActionUseCase: vi.fn(),
    executeCalendarActionUseCase: vi.fn(),
    executeLinearActionUseCase: vi.fn(),
    executeCodeActionUseCase: vi.fn(),
    retryPendingActionsUseCase: { execute: vi.fn() },
    changeActionTypeUseCase: vi.fn(),
    handleApprovalReplyUseCase: vi.fn(),
    research: { execute: vi.fn() },
    todo: { execute: vi.fn() },
    note: { execute: vi.fn() },
    link: { execute: vi.fn() },
    calendar: { execute: vi.fn() },
    linear: { execute: vi.fn() },
    code: { execute: vi.fn() },
    ...overrides,
  } as unknown as Services;
}

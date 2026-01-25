import type { ActionServiceClient } from './domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from './domain/ports/researchServiceClient.js';
import type { NotificationSender } from './domain/ports/notificationSender.js';
import type { ActionRepository } from './domain/ports/actionRepository.js';
import type { ActionTransitionRepository } from './domain/ports/actionTransitionRepository.js';
import type { CommandsAgentClient } from './domain/ports/commandsAgentClient.js';
import type { TodosServiceClient } from './domain/ports/todosServiceClient.js';
import type { NotesServiceClient } from './domain/ports/notesServiceClient.js';
import type { BookmarksServiceClient } from './domain/ports/bookmarksServiceClient.js';
import type { CalendarServiceClient } from './domain/ports/calendarServiceClient.js';
import type { LinearAgentClient } from './domain/ports/linearAgentClient.js';
import type { CodeAgentClient } from './domain/ports/codeAgentClient.js';
import type { ApprovalMessageRepository } from './domain/ports/approvalMessageRepository.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from './domain/usecases/handleResearchAction.js';
import {
  createHandleTodoActionUseCase,
  type HandleTodoActionUseCase,
} from './domain/usecases/handleTodoAction.js';
import {
  createHandleNoteActionUseCase,
  type HandleNoteActionUseCase,
} from './domain/usecases/handleNoteAction.js';
import {
  createHandleLinkActionUseCase,
  type HandleLinkActionUseCase,
} from './domain/usecases/handleLinkAction.js';
import {
  createHandleCalendarActionUseCase,
  type HandleCalendarActionUseCase,
} from './domain/usecases/handleCalendarAction.js';
import {
  createHandleLinearActionUseCase,
  type HandleLinearActionUseCase,
} from './domain/usecases/handleLinearAction.js';
import {
  createExecuteResearchActionUseCase,
  type ExecuteResearchActionUseCase,
} from './domain/usecases/executeResearchAction.js';
import {
  createExecuteTodoActionUseCase,
  type ExecuteTodoActionUseCase,
} from './domain/usecases/executeTodoAction.js';
import {
  createExecuteNoteActionUseCase,
  type ExecuteNoteActionUseCase,
} from './domain/usecases/executeNoteAction.js';
import {
  createExecuteLinkActionUseCase,
  type ExecuteLinkActionUseCase,
} from './domain/usecases/executeLinkAction.js';
import {
  createExecuteCalendarActionUseCase,
  type ExecuteCalendarActionUseCase,
} from './domain/usecases/executeCalendarAction.js';
import {
  createExecuteLinearActionUseCase,
  type ExecuteLinearActionUseCase,
} from './domain/usecases/executeLinearAction.js';
import {
  createHandleCodeActionUseCase,
  type HandleCodeActionUseCase,
} from './domain/usecases/handleCodeAction.js';
import {
  createExecuteCodeActionUseCase,
  type ExecuteCodeActionUseCase,
} from './domain/usecases/executeCodeAction.js';
import {
  createRetryPendingActionsUseCase,
  type RetryPendingActionsUseCase,
} from './domain/usecases/retryPendingActions.js';
import {
  createChangeActionTypeUseCase,
  type ChangeActionTypeUseCase,
} from './domain/usecases/changeActionType.js';
import {
  createHandleApprovalReplyUseCase,
  type HandleApprovalReplyUseCase,
} from './domain/usecases/handleApprovalReply.js';
import pino from 'pino';
import { createLocalActionServiceClient } from './infra/action/localActionServiceClient.js';
import { createResearchAgentClient } from './infra/research/researchAgentClient.js';
import { createWhatsappNotificationSender } from './infra/notification/whatsappNotificationSender.js';
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createFirestoreApprovalMessageRepository } from './infra/firestore/approvalMessageRepository.js';
import { registerActionHandler } from './domain/usecases/createIdempotentActionHandler.js';
import { createFirestoreActionTransitionRepository } from './infra/firestore/actionTransitionRepository.js';
import { createCommandsAgentHttpClient } from './infra/http/commandsAgentHttpClient.js';
import { createTodosServiceHttpClient } from './infra/http/todosServiceHttpClient.js';
import { createNotesServiceHttpClient } from './infra/http/notesServiceHttpClient.js';
import { createBookmarksServiceHttpClient } from './infra/http/bookmarksServiceHttpClient.js';
import { createCalendarServiceHttpClient } from './infra/http/calendarServiceHttpClient.js';
import { createLinearAgentHttpClient } from './infra/http/linearAgentHttpClient.js';
import { createCodeAgentHttpClient } from './infra/http/codeAgentHttpClient.js';
import { createActionEventPublisher, type ActionEventPublisher } from './infra/pubsub/index.js';
import {
  createWhatsAppSendPublisher,
  type WhatsAppSendPublisher,
  createCalendarPreviewPublisher,
  type CalendarPreviewPublisher,
} from '@intexuraos/infra-pubsub';
import { createUserServiceClient, type UserServiceClient } from './infra/user/index.js';
import { createApprovalIntentClassifierFactory } from './infra/llm/approvalIntentClassifierFactory.js';
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels } from '@intexuraos/llm-contract';

export interface Services {
  actionServiceClient: ActionServiceClient;
  researchServiceClient: ResearchServiceClient;
  notificationSender: NotificationSender;
  actionRepository: ActionRepository;
  actionTransitionRepository: ActionTransitionRepository;
  commandsAgentClient: CommandsAgentClient;
  todosServiceClient: TodosServiceClient;
  notesServiceClient: NotesServiceClient;
  bookmarksServiceClient: BookmarksServiceClient;
  calendarServiceClient: CalendarServiceClient;
  linearAgentClient: LinearAgentClient;
  codeAgentClient: CodeAgentClient;
  actionEventPublisher: ActionEventPublisher;
  whatsappPublisher: WhatsAppSendPublisher;
  calendarPreviewPublisher: CalendarPreviewPublisher;
  approvalMessageRepository: ApprovalMessageRepository;
  userServiceClient: UserServiceClient;
  handleResearchActionUseCase: HandleResearchActionUseCase;
  handleTodoActionUseCase: HandleTodoActionUseCase;
  handleNoteActionUseCase: HandleNoteActionUseCase;
  handleLinkActionUseCase: HandleLinkActionUseCase;
  handleCalendarActionUseCase: HandleCalendarActionUseCase;
  handleLinearActionUseCase: HandleLinearActionUseCase;
  handleCodeActionUseCase: HandleCodeActionUseCase;
  executeResearchActionUseCase: ExecuteResearchActionUseCase;
  executeTodoActionUseCase: ExecuteTodoActionUseCase;
  executeNoteActionUseCase: ExecuteNoteActionUseCase;
  executeLinkActionUseCase: ExecuteLinkActionUseCase;
  executeCalendarActionUseCase: ExecuteCalendarActionUseCase;
  executeLinearActionUseCase: ExecuteLinearActionUseCase;
  executeCodeActionUseCase: ExecuteCodeActionUseCase;
  retryPendingActionsUseCase: RetryPendingActionsUseCase;
  changeActionTypeUseCase: ChangeActionTypeUseCase;
  handleApprovalReplyUseCase: HandleApprovalReplyUseCase;
  // Action handler registry (for dynamic routing)
  research: HandleResearchActionUseCase;
  todo: HandleTodoActionUseCase;
  note: HandleNoteActionUseCase;
  link: HandleLinkActionUseCase;
  calendar: HandleCalendarActionUseCase;
  linear: HandleLinearActionUseCase;
  code: HandleCodeActionUseCase;
}

export interface ServiceConfig {
  ResearchAgentUrl: string;
  userServiceUrl: string;
  commandsAgentUrl: string;
  todosAgentUrl: string;
  notesAgentUrl: string;
  bookmarksAgentUrl: string;
  calendarAgentUrl: string;
  linearAgentUrl: string;
  codeAgentUrl: string;
  appSettingsServiceUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
  whatsappSendTopic: string;
  calendarPreviewTopic: string;
  webAppUrl: string;
}

let container: Services | null = null;

export async function initServices(config: ServiceConfig): Promise<void> {
  // Fetch pricing from app-settings-service
  const pricingResult = await fetchAllPricing(
    config.appSettingsServiceUrl,
    config.internalAuthToken
  );

  if (!pricingResult.ok) {
    throw new Error(`Failed to fetch pricing: ${pricingResult.error.message}`);
  }

  // Support common models for approval intent classification
  const pricingContext = createPricingContext(pricingResult.value, [
    LlmModels.Gemini25Flash,
    LlmModels.Gemini25Pro,
    LlmModels.ClaudeSonnet45,
    LlmModels.GPT52,
    LlmModels.Glm47,
    LlmModels.Glm47Flash,
    LlmModels.SonarPro,
  ]);

  const actionRepository = createFirestoreActionRepository({
    logger: pino({ name: 'actionRepository' }),
  });
  const actionTransitionRepository = createFirestoreActionTransitionRepository();
  const approvalMessageRepository = createFirestoreApprovalMessageRepository();
  const actionServiceClient = createLocalActionServiceClient(actionRepository);

  const userServiceClient = createUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext,
    logger: pino({ name: 'userServiceClient' }),
  });

  const approvalIntentClassifierFactory = createApprovalIntentClassifierFactory({
    userServiceClient,
  });

  const commandsAgentClient = createCommandsAgentHttpClient({
    baseUrl: config.commandsAgentUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const researchServiceClient = createResearchAgentClient({
    baseUrl: config.ResearchAgentUrl,
    internalAuthToken: config.internalAuthToken,
  });

  const notificationSender = createWhatsappNotificationSender({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
    logger: pino({ name: 'whatsapp-notification-sender' }),
  });

  const actionEventPublisher = createActionEventPublisher({
    projectId: config.gcpProjectId,
    logger: pino({ name: 'action-event-publisher' }),
  });

  const whatsappPublisher = createWhatsAppSendPublisher({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
    logger: pino({ name: 'whatsapp-publisher' }),
  });

  const calendarPreviewPublisher = createCalendarPreviewPublisher({
    projectId: config.gcpProjectId,
    topicName: config.calendarPreviewTopic,
    logger: pino({ name: 'calendar-preview-publisher' }),
  });

  const todosServiceClient = createTodosServiceHttpClient({
    baseUrl: config.todosAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'todosServiceClient' }),
  });

  const notesServiceClient = createNotesServiceHttpClient({
    baseUrl: config.notesAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'notesServiceClient' }),
  });

  const bookmarksServiceClient = createBookmarksServiceHttpClient({
    baseUrl: config.bookmarksAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'bookmarksServiceClient' }),
  });

  const calendarServiceClient = createCalendarServiceHttpClient({
    baseUrl: config.calendarAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'calendarServiceClient' }),
  });

  const linearAgentClient = createLinearAgentHttpClient({
    baseUrl: config.linearAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'linearAgentClient' }),
  });

  const codeAgentClient = createCodeAgentHttpClient({
    baseUrl: config.codeAgentUrl,
    internalAuthToken: config.internalAuthToken,
    logger: pino({ name: 'codeAgentClient' }),
  });

  const executeResearchActionUseCase = createExecuteResearchActionUseCase({
    actionRepository,
    researchServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeResearchAction' }),
  });

  const executeTodoActionUseCase = createExecuteTodoActionUseCase({
    actionRepository,
    todosServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeTodoAction' }),
  });

  const executeNoteActionUseCase = createExecuteNoteActionUseCase({
    actionRepository,
    notesServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeNoteAction' }),
  });

  const executeLinkActionUseCase = createExecuteLinkActionUseCase({
    actionRepository,
    bookmarksServiceClient,
    commandsAgentClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeLinkAction' }),
  });

  const executeCalendarActionUseCase = createExecuteCalendarActionUseCase({
    actionRepository,
    calendarServiceClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeCalendarAction' }),
  });

  const executeLinearActionUseCase = createExecuteLinearActionUseCase({
    actionRepository,
    linearAgentClient,
    whatsappPublisher,
    logger: pino({ name: 'executeLinearAction' }),
  });

  const executeCodeActionUseCase = createExecuteCodeActionUseCase({
    actionRepository,
    codeAgentClient,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'executeCodeAction' }),
  });

  const handleResearchActionUseCase = registerActionHandler(
    createHandleResearchActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: config.webAppUrl,
      logger: pino({ name: 'handleResearchAction' }),
      executeResearchAction: executeResearchActionUseCase,
    }
  );

  const handleTodoActionUseCase = registerActionHandler(
    createHandleTodoActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: config.webAppUrl,
      logger: pino({ name: 'handleTodoAction' }),
      executeTodoAction: executeTodoActionUseCase,
    }
  );

  const handleNoteActionUseCase = registerActionHandler(
    createHandleNoteActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: config.webAppUrl,
      logger: pino({ name: 'handleNoteAction' }),
      executeNoteAction: executeNoteActionUseCase,
    }
  );

  const handleLinkActionUseCase = registerActionHandler(
    createHandleLinkActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: config.webAppUrl,
      logger: pino({ name: 'handleLinkAction' }),
      executeLinkAction: executeLinkActionUseCase,
    }
  );

  const handleCalendarActionUseCase = registerActionHandler(
    createHandleCalendarActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      calendarPreviewPublisher,
      webAppUrl: config.webAppUrl,
      logger: pino({ name: 'handleCalendarAction' }),
    }
  );

  const handleLinearActionUseCase = registerActionHandler(createHandleLinearActionUseCase, {
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleLinearAction' }),
  });

  const handleCodeActionUseCase = registerActionHandler(createHandleCodeActionUseCase, {
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleCodeAction' }),
    executeCodeAction: executeCodeActionUseCase,
  });

  const retryPendingActionsUseCase = createRetryPendingActionsUseCase({
    actionRepository,
    actionEventPublisher,
    actionHandlerRegistry: {
      research: handleResearchActionUseCase,
      todo: handleTodoActionUseCase,
      note: handleNoteActionUseCase,
      link: handleLinkActionUseCase,
      calendar: handleCalendarActionUseCase,
      linear: handleLinearActionUseCase,
      code: handleCodeActionUseCase,
    },
    logger: pino({ name: 'retryPendingActions' }),
  });

  const changeActionTypeUseCase = createChangeActionTypeUseCase({
    actionRepository,
    actionTransitionRepository,
    commandsAgentClient,
    logger: pino({ name: 'changeActionType' }),
  });

  const handleApprovalReplyUseCase = createHandleApprovalReplyUseCase({
    actionRepository,
    approvalMessageRepository,
    approvalIntentClassifierFactory,
    whatsappPublisher,
    actionEventPublisher,
    logger: pino({ name: 'handleApprovalReply' }),
    executeNoteAction: executeNoteActionUseCase,
    executeTodoAction: executeTodoActionUseCase,
    executeResearchAction: executeResearchActionUseCase,
    executeLinkAction: executeLinkActionUseCase,
    executeCalendarAction: executeCalendarActionUseCase,
    executeLinearAction: executeLinearActionUseCase,
    executeCodeAction: executeCodeActionUseCase,
  });

  container = {
    actionServiceClient,
    researchServiceClient,
    notificationSender,
    actionRepository,
    actionTransitionRepository,
    commandsAgentClient,
    todosServiceClient,
    notesServiceClient,
    bookmarksServiceClient,
    calendarServiceClient,
    linearAgentClient,
    codeAgentClient,
    actionEventPublisher,
    whatsappPublisher,
    calendarPreviewPublisher,
    approvalMessageRepository,
    userServiceClient,
    handleResearchActionUseCase,
    handleTodoActionUseCase,
    handleNoteActionUseCase,
    handleLinkActionUseCase,
    handleCalendarActionUseCase,
    handleLinearActionUseCase,
    handleCodeActionUseCase,
    executeResearchActionUseCase,
    executeTodoActionUseCase,
    executeNoteActionUseCase,
    executeLinkActionUseCase,
    executeCalendarActionUseCase,
    executeLinearActionUseCase,
    executeCodeActionUseCase,
    retryPendingActionsUseCase,
    changeActionTypeUseCase,
    handleApprovalReplyUseCase,
    // Action handler registry (for dynamic routing)
    research: handleResearchActionUseCase,
    todo: handleTodoActionUseCase,
    note: handleNoteActionUseCase,
    link: handleLinkActionUseCase,
    calendar: handleCalendarActionUseCase,
    linear: handleLinearActionUseCase,
    code: handleCodeActionUseCase,
  };
}

export function getServices(): Services {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: Services): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}

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
  createRetryPendingActionsUseCase,
  type RetryPendingActionsUseCase,
} from './domain/usecases/retryPendingActions.js';
import {
  createChangeActionTypeUseCase,
  type ChangeActionTypeUseCase,
} from './domain/usecases/changeActionType.js';
import pino from 'pino';
import { createLocalActionServiceClient } from './infra/action/localActionServiceClient.js';
import { createResearchAgentClient } from './infra/research/researchAgentClient.js';
import { createWhatsappNotificationSender } from './infra/notification/whatsappNotificationSender.js';
import { createFirestoreActionRepository } from './infra/firestore/actionRepository.js';
import { createFirestoreActionTransitionRepository } from './infra/firestore/actionTransitionRepository.js';
import { createCommandsAgentHttpClient } from './infra/http/commandsAgentHttpClient.js';
import { createTodosServiceHttpClient } from './infra/http/todosServiceHttpClient.js';
import { createNotesServiceHttpClient } from './infra/http/notesServiceHttpClient.js';
import { createBookmarksServiceHttpClient } from './infra/http/bookmarksServiceHttpClient.js';
import { createCalendarServiceHttpClient } from './infra/http/calendarServiceHttpClient.js';
import { createActionEventPublisher, type ActionEventPublisher } from './infra/pubsub/index.js';
import { createWhatsAppSendPublisher, type WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';

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
  actionEventPublisher: ActionEventPublisher;
  whatsappPublisher: WhatsAppSendPublisher;
  handleResearchActionUseCase: HandleResearchActionUseCase;
  handleTodoActionUseCase: HandleTodoActionUseCase;
  handleNoteActionUseCase: HandleNoteActionUseCase;
  handleLinkActionUseCase: HandleLinkActionUseCase;
  handleCalendarActionUseCase: HandleCalendarActionUseCase;
  executeResearchActionUseCase: ExecuteResearchActionUseCase;
  executeTodoActionUseCase: ExecuteTodoActionUseCase;
  executeNoteActionUseCase: ExecuteNoteActionUseCase;
  executeLinkActionUseCase: ExecuteLinkActionUseCase;
  executeCalendarActionUseCase: ExecuteCalendarActionUseCase;
  retryPendingActionsUseCase: RetryPendingActionsUseCase;
  changeActionTypeUseCase: ChangeActionTypeUseCase;
  // Action handler registry (for dynamic routing)
  research: HandleResearchActionUseCase;
  todo: HandleTodoActionUseCase;
  note: HandleNoteActionUseCase;
  link: HandleLinkActionUseCase;
  calendar: HandleCalendarActionUseCase;
}

export interface ServiceConfig {
  ResearchAgentUrl: string;
  userServiceUrl: string;
  commandsAgentUrl: string;
  todosAgentUrl: string;
  notesAgentUrl: string;
  bookmarksAgentUrl: string;
  calendarAgentUrl: string;
  internalAuthToken: string;
  gcpProjectId: string;
  whatsappSendTopic: string;
  webAppUrl: string;
}

let container: Services | null = null;

export function initServices(config: ServiceConfig): void {
  const actionRepository = createFirestoreActionRepository({
    logger: pino({ name: 'actionRepository' }),
  });
  const actionTransitionRepository = createFirestoreActionTransitionRepository();
  const actionServiceClient = createLocalActionServiceClient(actionRepository);

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
  });

  const actionEventPublisher = createActionEventPublisher({
    projectId: config.gcpProjectId,
  });

  const whatsappPublisher = createWhatsAppSendPublisher({
    projectId: config.gcpProjectId,
    topicName: config.whatsappSendTopic,
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

  const handleResearchActionUseCase = createHandleResearchActionUseCase({
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleResearchAction' }),
    executeResearchAction: executeResearchActionUseCase,
  });

  const handleTodoActionUseCase = createHandleTodoActionUseCase({
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleTodoAction' }),
    executeTodoAction: executeTodoActionUseCase,
  });

  const handleNoteActionUseCase = createHandleNoteActionUseCase({
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleNoteAction' }),
    executeNoteAction: executeNoteActionUseCase,
  });

  const handleLinkActionUseCase = createHandleLinkActionUseCase({
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleLinkAction' }),
    executeLinkAction: executeLinkActionUseCase,
  });

  const handleCalendarActionUseCase = createHandleCalendarActionUseCase({
    actionServiceClient,
    actionRepository,
    whatsappPublisher,
    webAppUrl: config.webAppUrl,
    logger: pino({ name: 'handleCalendarAction' }),
    executeCalendarAction: executeCalendarActionUseCase,
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
    },
    logger: pino({ name: 'retryPendingActions' }),
  });

  const changeActionTypeUseCase = createChangeActionTypeUseCase({
    actionRepository,
    actionTransitionRepository,
    commandsAgentClient,
    logger: pino({ name: 'changeActionType' }),
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
    actionEventPublisher,
    whatsappPublisher,
    handleResearchActionUseCase,
    handleTodoActionUseCase,
    handleNoteActionUseCase,
    handleLinkActionUseCase,
    handleCalendarActionUseCase,
    executeResearchActionUseCase,
    executeTodoActionUseCase,
    executeNoteActionUseCase,
    executeLinkActionUseCase,
    executeCalendarActionUseCase,
    retryPendingActionsUseCase,
    changeActionTypeUseCase,
    // Action handler registry (for dynamic routing)
    research: handleResearchActionUseCase,
    todo: handleTodoActionUseCase,
    note: handleNoteActionUseCase,
    link: handleLinkActionUseCase,
    calendar: handleCalendarActionUseCase,
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

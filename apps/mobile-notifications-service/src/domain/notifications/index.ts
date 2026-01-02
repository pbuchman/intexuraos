/**
 * Mobile notifications domain layer.
 *
 * Provides:
 * - models/    Domain entities (Notification, SignatureConnection)
 * - ports/     Interfaces for external dependencies (Repositories)
 * - usecases/  Business logic (createConnection, processNotification, etc.)
 */

// Models
export type {
  Notification,
  CreateNotificationInput,
  SignatureConnection,
  CreateSignatureConnectionInput,
} from './models/index.js';

// Ports
export type {
  SignatureConnectionRepository,
  NotificationRepository,
  RepositoryError,
  PaginationOptions,
  PaginatedNotifications,
  FilterOptions,
} from './ports/index.js';

// Usecases
export {
  createConnection,
  hashSignature,
  type CreateConnectionInput,
  type CreateConnectionOutput,
  type CreateConnectionError,
} from './usecases/index.js';
export {
  processNotification,
  type WebhookPayload,
  type ProcessNotificationInput,
  type ProcessNotificationOutput,
} from './usecases/index.js';
export { listNotifications, type ListNotificationsInput } from './usecases/index.js';
export {
  deleteNotification,
  type DeleteNotificationInput,
  type DeleteNotificationError,
} from './usecases/index.js';

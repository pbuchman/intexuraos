/**
 * Notification entity representing a mobile device notification.
 */
export interface Notification {
  /** Unique identifier (Firestore doc ID) */
  id: string;
  /** User who owns this notification */
  userId: string;
  /** Source of the notification (e.g., 'tasker') */
  source: string;
  /** Device name that sent the notification */
  device: string;
  /** App package name or identifier */
  app: string;
  /** Notification title */
  title: string;
  /** Notification content/body */
  text: string;
  /** Timestamp from the device (Unix milliseconds) */
  timestamp: number;
  /** Post time string from device */
  postTime: string;
  /** Server-side received timestamp (ISO string) */
  receivedAt: string;
  /** Idempotency key from device (unique per user) */
  notificationId: string;
}

/**
 * Input for creating a new notification.
 */
export interface CreateNotificationInput {
  userId: string;
  source: string;
  device: string;
  app: string;
  title: string;
  text: string;
  timestamp: number;
  postTime: string;
  notificationId: string;
}

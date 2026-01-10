/**
 * Zod schemas for composite feed data output.
 * Used for both validation and JSON Schema generation for LLM consumption.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Schema for a single notification item.
 */
export const notificationItemSchema = z.object({
  id: z.string().describe('Unique notification identifier'),
  app: z.string().describe('Application that sent the notification'),
  title: z.string().describe('Notification title'),
  body: z.string().describe('Notification body text'),
  timestamp: z.string().datetime().describe('When the notification was received'),
  source: z.string().optional().describe('Source within the app (e.g., channel, contact)'),
});

/**
 * Schema for filter criteria applied to notifications.
 */
export const filterCriteriaSchema = z.object({
  app: z.array(z.string()).optional().describe('Filter by app names (any match)'),
  source: z.string().optional().describe('Filter by source'),
  title: z.string().optional().describe('Filter by title containing this text'),
});

/**
 * Schema for a filtered notification group.
 */
export const filteredNotificationsSchema = z.object({
  filterId: z.string().describe('Filter configuration ID'),
  filterName: z.string().describe('Human-readable filter name'),
  criteria: filterCriteriaSchema,
  items: z.array(notificationItemSchema).describe('Notifications matching the filter'),
});

/**
 * Schema for a static data source.
 */
export const staticSourceSchema = z.object({
  id: z.string().describe('Data source ID'),
  name: z.string().describe('Data source name/title'),
  content: z.string().describe('Full text content of the data source'),
});

/**
 * Complete schema for composite feed data output.
 */
export const compositeFeedDataSchema = z.object({
  feedId: z.string().describe('Composite feed identifier'),
  feedName: z.string().describe('Human-readable feed name'),
  purpose: z.string().describe('Description of what this feed is used for'),
  generatedAt: z.string().datetime().describe('When this data snapshot was generated'),
  staticSources: z
    .array(staticSourceSchema)
    .max(5)
    .describe('Static data sources included in this feed'),
  notifications: z
    .array(filteredNotificationsSchema)
    .max(3)
    .describe('Filtered mobile notification groups'),
});

export type CompositeFeedData = z.infer<typeof compositeFeedDataSchema>;
export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type FilterCriteria = z.infer<typeof filterCriteriaSchema>;
export type FilteredNotifications = z.infer<typeof filteredNotificationsSchema>;
export type StaticSource = z.infer<typeof staticSourceSchema>;

/**
 * Get the JSON Schema representation of composite feed data.
 * This schema is returned by the /schema endpoint for LLM consumption.
 */
export function getCompositeFeedJsonSchema(): object {
  return zodToJsonSchema(compositeFeedDataSchema, {
    name: 'CompositeFeedData',
    $refStrategy: 'none',
  });
}

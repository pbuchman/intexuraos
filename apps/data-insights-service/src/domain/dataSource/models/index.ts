/**
 * Data source domain models.
 */

/**
 * A custom data source uploaded by a user.
 */
export interface DataSource {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request to create a new data source.
 */
export interface CreateDataSourceRequest {
  title: string;
  content: string;
}

/**
 * Request to update an existing data source.
 */
export interface UpdateDataSourceRequest {
  title?: string;
  content?: string;
}

/**
 * Request to generate a title from content.
 */
export interface GenerateTitleRequest {
  content: string;
}

/**
 * Maximum allowed characters for content.
 */
export const MAX_CONTENT_LENGTH = 60000;

/**
 * Maximum allowed characters for title.
 */
export const MAX_TITLE_LENGTH = 200;

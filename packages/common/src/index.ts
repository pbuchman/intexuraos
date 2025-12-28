/**
 * @intexuraos/common
 *
 * Facade package that re-exports from decomposed packages.
 * For backward compatibility - consumers can continue using @intexuraos/common.
 *
 * New code should prefer importing directly from:
 * - @intexuraos/common-core - Result types, errors, redaction
 * - @intexuraos/common-http - Fastify helpers, auth
 * - @intexuraos/infra-firestore - Firestore client
 * - @intexuraos/infra-notion - Notion client
 */

// Re-export everything from common-core
export {
  type Result,
  ok,
  err,
  isOk,
  isErr,
  type ErrorCode,
  ERROR_HTTP_STATUS,
  IntexuraOSError,
  getErrorMessage,
  redactToken,
  redactObject,
  SENSITIVE_FIELDS,
} from '@intexuraos/common-core';

// Re-export everything from common-http
export {
  type Diagnostics,
  type ApiOk,
  type ApiError,
  type ErrorBody,
  type ApiResponse,
  apiOk,
  apiFail,
  REQUEST_ID_HEADER,
  getRequestId,
  intexuraFastifyPlugin,
  handleValidationError,
  shouldLogRequest,
  registerQuietHealthCheckLogging,
  type JwtConfig,
  type VerifiedJwt,
  verifyJwt,
  clearJwksCache,
  type AuthUser,
  requireAuth,
  tryAuth,
  fastifyAuthPlugin,
} from '@intexuraos/common-http';

// Re-export everything from infra-firestore
export {
  getFirestore,
  resetFirestore,
  setFirestore,
  createFakeFirestore,
  type FakeFirestore,
  type FakeFirestoreConfig,
} from '@intexuraos/infra-firestore';

// Re-export everything from infra-notion
export {
  type NotionLogger,
  type NotionErrorCode,
  type NotionError,
  type NotionPagePreview,
  mapNotionError,
  createNotionClient,
  NotionClient,
  type BlockObjectResponse,
  validateNotionToken,
  getPageWithPreview,
  extractPageTitle,
  type NotionConnectionPublic,
  saveNotionConnection,
  getNotionConnection,
  getNotionToken,
  isNotionConnected,
  disconnectNotion,
} from '@intexuraos/infra-notion';

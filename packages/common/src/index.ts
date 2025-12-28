// Result types
export { type Result, ok, err, isOk, isErr } from './result.js';

// HTTP utilities
export {
  type ErrorCode,
  ERROR_HTTP_STATUS,
  IntexuraOSError,
  getErrorMessage,
} from './http/errors.js';

export {
  type Diagnostics,
  type ApiOk,
  type ApiError,
  type ErrorBody,
  type ApiResponse,
  ok as apiOk,
  fail as apiFail,
} from './http/response.js';

export { REQUEST_ID_HEADER, getRequestId } from './http/requestId.js';

export { intexuraFastifyPlugin } from './http/fastifyPlugin.js';

export { handleValidationError } from './http/validation.js';

// Logger utilities
export { shouldLogRequest, registerQuietHealthCheckLogging } from './http/logger.js';

// Auth utilities
export { type JwtConfig, type VerifiedJwt, verifyJwt, clearJwksCache } from './auth/jwt.js';

export {
  type AuthUser,
  requireAuth,
  tryAuth,
  fastifyAuthPlugin,
} from './auth/fastifyAuthPlugin.js';

// Security utilities
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';

// Firestore client
export { getFirestore, resetFirestore, setFirestore } from './firestore.js';

// Notion client
export {
  type NotionLogger,
  type NotionErrorCode,
  type NotionError,
  mapNotionError,
  createNotionClient,
  NotionClient,
  type BlockObjectResponse,
} from './notion.js';

// Testing utilities
export {
  createFakeFirestore,
  type FakeFirestore,
  type FakeFirestoreConfig,
} from './testing/index.js';

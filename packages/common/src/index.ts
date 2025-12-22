// Result types
export { type Result, ok, err, isOk, isErr } from './result.js';

// HTTP utilities
export { type ErrorCode, ERROR_HTTP_STATUS, PraxOSError, getErrorMessage } from './http/errors.js';

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

export { praxosFastifyPlugin } from './http/fastifyPlugin.js';

// Auth utilities
export { type JwtConfig, type VerifiedJwt, verifyJwt, clearJwksCache } from './auth/jwt.js';

export { type AuthUser, requireAuth, fastifyAuthPlugin } from './auth/fastifyAuthPlugin.js';

// Security utilities
export { redactToken, redactObject, SENSITIVE_FIELDS } from './redaction.js';

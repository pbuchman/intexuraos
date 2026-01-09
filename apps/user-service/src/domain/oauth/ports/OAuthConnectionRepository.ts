/**
 * Port for OAuth connection persistence.
 * Implemented by infra layer (Firestore).
 */

import type { Result } from '@intexuraos/common-core';
import type {
  OAuthConnection,
  OAuthConnectionPublic,
  OAuthProvider,
  OAuthTokens,
} from '../models/OAuthConnection.js';
import type { OAuthError } from '../models/OAuthError.js';

export interface OAuthConnectionRepository {
  saveConnection(
    userId: string,
    provider: OAuthProvider,
    email: string,
    tokens: OAuthTokens
  ): Promise<Result<OAuthConnectionPublic, OAuthError>>;

  getConnection(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnection | null, OAuthError>>;

  getConnectionPublic(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnectionPublic | null, OAuthError>>;

  updateTokens(
    userId: string,
    provider: OAuthProvider,
    tokens: OAuthTokens
  ): Promise<Result<void, OAuthError>>;

  deleteConnection(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<void, OAuthError>>;
}

/**
 * Fake repositories for user-service testing.
 *
 * These fakes implement domain port interfaces with in-memory storage.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { EncryptedValue, Encryptor } from '../infra/encryption.js';
import type {
  Auth0Client,
  AuthError,
  AuthTokenRepository,
  AuthTokens,
  AuthTokensPublic,
  RefreshResult,
} from '../domain/identity/index.js';
import type {
  LlmProvider,
  LlmTestResponse,
  LlmTestResult,
  LlmValidationError,
  LlmValidator,
  SettingsError,
  UserSettings,
  UserSettingsRepository,
} from '../domain/settings/index.js';
import type {
  OAuthConnection,
  OAuthConnectionPublic,
  OAuthProvider,
  OAuthTokens,
} from '../domain/oauth/models/OAuthConnection.js';
import type { OAuthError } from '../domain/oauth/models/OAuthError.js';
import type { OAuthConnectionRepository } from '../domain/oauth/ports/OAuthConnectionRepository.js';
import type {
  GoogleOAuthClient,
  GoogleTokenResponse,
  GoogleUserInfo,
} from '../domain/oauth/ports/GoogleOAuthClient.js';

/**
 * Fake Auth token repository for testing.
 */
export class FakeAuthTokenRepository implements AuthTokenRepository {
  private tokens = new Map<string, AuthTokens>();
  private shouldFailGetRefreshToken = false;
  private shouldFailSaveTokens = false;
  private shouldThrowOnDeleteTokens = false;
  private shouldThrowOnHasRefreshToken = false;
  private shouldFailHasRefreshToken = false;

  /**
   * Configure the fake to fail the next getRefreshToken call.
   */
  setFailNextGetRefreshToken(fail: boolean): void {
    this.shouldFailGetRefreshToken = fail;
  }

  /**
   * Configure the fake to fail the next saveTokens call.
   */
  setFailNextSaveTokens(fail: boolean): void {
    this.shouldFailSaveTokens = fail;
  }

  /**
   * Configure the fake to throw an exception on deleteTokens (for best-effort error testing).
   */
  setThrowOnDeleteTokens(shouldThrow: boolean): void {
    this.shouldThrowOnDeleteTokens = shouldThrow;
  }

  /**
   * Configure the fake to throw an exception on hasRefreshToken (for best-effort error testing).
   */
  setThrowOnHasRefreshToken(shouldThrow: boolean): void {
    this.shouldThrowOnHasRefreshToken = shouldThrow;
  }

  /**
   * Configure the fake to return an error result on hasRefreshToken.
   */
  setFailHasRefreshToken(fail: boolean): void {
    this.shouldFailHasRefreshToken = fail;
  }

  /**
   * Store tokens directly (for test setup).
   */
  setTokens(userId: string, tokens: AuthTokens): void {
    this.tokens.set(userId, tokens);
  }

  saveTokens(userId: string, tokens: AuthTokens): Promise<Result<AuthTokensPublic, AuthError>> {
    if (this.shouldFailSaveTokens) {
      this.shouldFailSaveTokens = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }
    this.tokens.set(userId, tokens);
    const now = new Date().toISOString();
    return Promise.resolve(
      ok({
        userId,
        hasRefreshToken: true,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        scope: tokens.scope,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  getTokenMetadata(userId: string): Promise<Result<AuthTokensPublic | null, AuthError>> {
    const tokens = this.tokens.get(userId);
    if (tokens === undefined) return Promise.resolve(ok(null));
    const now = new Date().toISOString();
    return Promise.resolve(
      ok({
        userId,
        hasRefreshToken: true,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        scope: tokens.scope,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  getRefreshToken(userId: string): Promise<Result<string | null, AuthError>> {
    if (this.shouldFailGetRefreshToken) {
      this.shouldFailGetRefreshToken = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated Firestore error' }));
    }
    const tokens = this.tokens.get(userId);
    return Promise.resolve(ok(tokens?.refreshToken ?? null));
  }

  hasRefreshToken(userId: string): Promise<Result<boolean, AuthError>> {
    if (this.shouldThrowOnHasRefreshToken) {
      this.shouldThrowOnHasRefreshToken = false;
      throw new Error('Simulated Firestore error on hasRefreshToken');
    }
    if (this.shouldFailHasRefreshToken) {
      this.shouldFailHasRefreshToken = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated error' }));
    }
    const tokens = this.tokens.get(userId);
    return Promise.resolve(ok(tokens !== undefined));
  }

  deleteTokens(userId: string): Promise<Result<void, AuthError>> {
    if (this.shouldThrowOnDeleteTokens) {
      this.shouldThrowOnDeleteTokens = false;
      throw new Error('Simulated Firestore error on delete');
    }
    this.tokens.delete(userId);
    return Promise.resolve(ok(undefined));
  }

  /**
   * Clear all tokens (for test cleanup).
   */
  clear(): void {
    this.tokens.clear();
  }

  /**
   * Get tokens (for test verification).
   */
  getStoredTokens(userId: string): AuthTokens | undefined {
    return this.tokens.get(userId);
  }
}

/**
 * Fake Auth0 client for testing.
 */
export class FakeAuth0Client implements Auth0Client {
  private nextResult: Result<RefreshResult, AuthError> | null = null;
  private shouldThrow = false;

  /**
   * Set the result to return on next call.
   */
  setNextResult(result: Result<RefreshResult, AuthError>): void {
    this.nextResult = result;
  }

  /**
   * Configure the fake to throw an exception on next call.
   */
  setThrowOnNextCall(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  refreshAccessToken(_refreshToken: string): Promise<Result<RefreshResult, AuthError>> {
    if (this.shouldThrow) {
      this.shouldThrow = false;
      throw new Error('Simulated Auth0 error');
    }

    if (this.nextResult !== null) {
      const result = this.nextResult;
      this.nextResult = null;
      return Promise.resolve(result);
    }

    // Default: return a successful refresh
    return Promise.resolve(
      ok({
        accessToken: 'new-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'openid profile email',
        idToken: 'new-id-token',
        refreshToken: undefined,
      })
    );
  }
}

/**
 * Fake User settings repository for testing.
 */
export class FakeUserSettingsRepository implements UserSettingsRepository {
  private settings = new Map<string, UserSettings>();
  private shouldFailGet = false;
  private shouldThrowOnGet = false;
  private shouldFailSave = false;
  private shouldFailUpdateLlmKey = false;
  private shouldFailDeleteLlmKey = false;

  /**
   * Configure the fake to fail the next getSettings call.
   */
  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  /**
   * Configure the fake to throw an exception on next getSettings call.
   */
  setThrowOnGet(shouldThrow: boolean): void {
    this.shouldThrowOnGet = shouldThrow;
  }

  /**
   * Configure the fake to fail the next saveSettings call.
   */
  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  /**
   * Configure the fake to fail the next updateLlmApiKey call.
   */
  setFailNextUpdateLlmKey(fail: boolean): void {
    this.shouldFailUpdateLlmKey = fail;
  }

  /**
   * Configure the fake to fail the next deleteLlmApiKey call.
   */
  setFailNextDeleteLlmKey(fail: boolean): void {
    this.shouldFailDeleteLlmKey = fail;
  }

  /**
   * Store settings directly (for test setup).
   */
  setSettings(settings: UserSettings): void {
    this.settings.set(settings.userId, settings);
  }

  getSettings(userId: string): Promise<Result<UserSettings | null, SettingsError>> {
    if (this.shouldThrowOnGet) {
      this.shouldThrowOnGet = false;
      throw new Error('Unexpected exception in getSettings');
    }
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated get failure' }));
    }
    const settings = this.settings.get(userId);
    return Promise.resolve(ok(settings ?? null));
  }

  saveSettings(settings: UserSettings): Promise<Result<UserSettings, SettingsError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }
    this.settings.set(settings.userId, settings);
    return Promise.resolve(ok(settings));
  }

  updateLlmApiKey(
    userId: string,
    provider: LlmProvider,
    encryptedKey: EncryptedValue
  ): Promise<Result<void, SettingsError>> {
    if (this.shouldFailUpdateLlmKey) {
      this.shouldFailUpdateLlmKey = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated update LLM key failure' })
      );
    }

    let existing = this.settings.get(userId);
    if (existing === undefined) {
      const now = new Date().toISOString();
      existing = {
        userId,
        llmApiKeys: {},
        createdAt: now,
        updatedAt: now,
      };
    }

    const llmApiKeys = existing.llmApiKeys ?? {};
    llmApiKeys[provider] = encryptedKey;
    existing.llmApiKeys = llmApiKeys;
    existing.updatedAt = new Date().toISOString();

    this.settings.set(userId, existing);
    return Promise.resolve(ok(undefined));
  }

  deleteLlmApiKey(userId: string, provider: LlmProvider): Promise<Result<void, SettingsError>> {
    if (this.shouldFailDeleteLlmKey) {
      this.shouldFailDeleteLlmKey = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated delete LLM key failure' })
      );
    }

    const existing = this.settings.get(userId);
    if (existing !== undefined) {
      if (existing.llmApiKeys !== undefined) {
        const { [provider]: _removed, ...rest } = existing.llmApiKeys;
        existing.llmApiKeys = rest;
      }
      if (existing.llmTestResults !== undefined) {
        const { [provider]: _removed, ...rest } = existing.llmTestResults;
        existing.llmTestResults = rest;
      }
      existing.updatedAt = new Date().toISOString();
      this.settings.set(userId, existing);
    }

    return Promise.resolve(ok(undefined));
  }

  updateLlmTestResult(
    userId: string,
    provider: LlmProvider,
    testResult: LlmTestResult
  ): Promise<Result<void, SettingsError>> {
    let existing = this.settings.get(userId);
    if (existing === undefined) {
      const now = new Date().toISOString();
      existing = {
        userId,
        llmTestResults: {},
        createdAt: now,
        updatedAt: now,
      };
    }

    const llmTestResults = existing.llmTestResults ?? {};
    llmTestResults[provider] = testResult;
    existing.llmTestResults = llmTestResults;
    existing.updatedAt = new Date().toISOString();

    this.settings.set(userId, existing);
    return Promise.resolve(ok(undefined));
  }

  updateLlmLastUsed(userId: string, provider: LlmProvider): Promise<Result<void, SettingsError>> {
    let existing = this.settings.get(userId);
    const now = new Date().toISOString();

    if (existing === undefined) {
      existing = {
        userId,
        llmTestResults: { [provider]: { response: '', testedAt: now } },
        createdAt: now,
        updatedAt: now,
      };
    } else {
      const llmTestResults = existing.llmTestResults ?? {};
      const existingResult = llmTestResults[provider];
      llmTestResults[provider] = {
        status: existingResult?.status ?? 'success',
        message: existingResult?.message ?? '',
        testedAt: now,
      };
      existing.llmTestResults = llmTestResults;
      existing.updatedAt = now;
    }

    this.settings.set(userId, existing);
    return Promise.resolve(ok(undefined));
  }

  /**
   * Clear all settings (for test cleanup).
   */
  clear(): void {
    this.settings.clear();
  }

  /**
   * Get stored settings (for test verification).
   */
  getStoredSettings(userId: string): UserSettings | undefined {
    return this.settings.get(userId);
  }
}

/**
 * Fake Encryptor for testing.
 */
export class FakeEncryptor implements Encryptor {
  private shouldFailEncrypt = false;
  private shouldFailDecrypt = false;

  setFailNextEncrypt(fail: boolean): void {
    this.shouldFailEncrypt = fail;
  }

  setFailNextDecrypt(fail: boolean): void {
    this.shouldFailDecrypt = fail;
  }

  encrypt(plaintext: string): Result<EncryptedValue, Error> {
    if (this.shouldFailEncrypt) {
      this.shouldFailEncrypt = false;
      return err(new Error('Simulated encryption failure'));
    }
    return ok({
      iv: 'fake-iv',
      tag: 'fake-tag',
      ciphertext: Buffer.from(plaintext).toString('base64'),
    });
  }

  decrypt(encrypted: EncryptedValue): Result<string, Error> {
    if (this.shouldFailDecrypt) {
      this.shouldFailDecrypt = false;
      return err(new Error('Simulated decryption failure'));
    }
    return ok(Buffer.from(encrypted.ciphertext, 'base64').toString('utf8'));
  }
}

/**
 * Fake LLM Validator for testing.
 */
export class FakeLlmValidator implements LlmValidator {
  private shouldFailValidation = false;
  private shouldFailTest = false;
  private validationError: LlmValidationError | null = null;
  private testResponse = 'Hello! I am a test model.';

  setFailNextValidation(fail: boolean, error?: LlmValidationError): void {
    this.shouldFailValidation = fail;
    this.validationError = error ?? { code: 'INVALID_KEY', message: 'Invalid API key' };
  }

  setFailNextTest(fail: boolean): void {
    this.shouldFailTest = fail;
  }

  setTestResponse(response: string): void {
    this.testResponse = response;
  }

  validateKey(_provider: LlmProvider, _apiKey: string): Promise<Result<void, LlmValidationError>> {
    if (this.shouldFailValidation) {
      this.shouldFailValidation = false;
      return Promise.resolve(
        err(this.validationError ?? { code: 'INVALID_KEY', message: 'Invalid API key' })
      );
    }
    return Promise.resolve(ok(undefined));
  }

  testRequest(
    _provider: LlmProvider,
    _apiKey: string,
    _prompt: string
  ): Promise<Result<LlmTestResponse, LlmValidationError>> {
    if (this.shouldFailTest) {
      this.shouldFailTest = false;
      return Promise.resolve(err({ code: 'API_ERROR', message: 'Test request failed' }));
    }
    return Promise.resolve(ok({ content: this.testResponse }));
  }
}

/**
 * Fake OAuth Connection Repository for testing.
 */
export class FakeOAuthConnectionRepository implements OAuthConnectionRepository {
  private connections = new Map<string, OAuthConnection>();
  private shouldFailSave = false;
  private shouldFailGet = false;
  private shouldFailGetPublic = false;
  private shouldFailUpdate = false;
  private shouldFailDelete = false;

  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextGetPublic(fail: boolean): void {
    this.shouldFailGetPublic = fail;
  }

  setFailNextUpdate(fail: boolean): void {
    this.shouldFailUpdate = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  setConnection(userId: string, provider: OAuthProvider, connection: OAuthConnection): void {
    this.connections.set(`${userId}:${provider}`, connection);
  }

  saveConnection(
    userId: string,
    provider: OAuthProvider,
    email: string,
    tokens: OAuthTokens
  ): Promise<Result<OAuthConnectionPublic, OAuthError>> {
    if (this.shouldFailSave) {
      this.shouldFailSave = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated save failure' }));
    }

    const now = new Date().toISOString();
    const connection: OAuthConnection = {
      userId,
      provider,
      email,
      tokens,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.set(`${userId}:${provider}`, connection);

    return Promise.resolve(
      ok({
        userId,
        provider,
        email,
        scopes: tokens.scope.split(' '),
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  getConnection(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnection | null, OAuthError>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated get failure' }));
    }
    const connection = this.connections.get(`${userId}:${provider}`);
    return Promise.resolve(ok(connection ?? null));
  }

  getConnectionPublic(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthConnectionPublic | null, OAuthError>> {
    if (this.shouldFailGetPublic) {
      this.shouldFailGetPublic = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Simulated getPublic failure' })
      );
    }
    const connection = this.connections.get(`${userId}:${provider}`);
    if (connection === undefined) {
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(
      ok({
        userId: connection.userId,
        provider: connection.provider,
        email: connection.email,
        scopes: connection.tokens.scope.split(' '),
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      })
    );
  }

  updateTokens(
    userId: string,
    provider: OAuthProvider,
    tokens: OAuthTokens
  ): Promise<Result<void, OAuthError>> {
    if (this.shouldFailUpdate) {
      this.shouldFailUpdate = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated update failure' }));
    }

    const existing = this.connections.get(`${userId}:${provider}`);
    if (existing === undefined) {
      return Promise.resolve(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'Connection not found' })
      );
    }

    existing.tokens = tokens;
    existing.updatedAt = new Date().toISOString();
    this.connections.set(`${userId}:${provider}`, existing);
    return Promise.resolve(ok(undefined));
  }

  deleteConnection(userId: string, provider: OAuthProvider): Promise<Result<void, OAuthError>> {
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false;
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'Simulated delete failure' }));
    }
    this.connections.delete(`${userId}:${provider}`);
    return Promise.resolve(ok(undefined));
  }

  getStoredConnection(userId: string, provider: OAuthProvider): OAuthConnection | undefined {
    return this.connections.get(`${userId}:${provider}`);
  }

  clear(): void {
    this.connections.clear();
  }
}

/**
 * Fake Google OAuth Client for testing.
 */
export class FakeGoogleOAuthClient implements GoogleOAuthClient {
  private shouldFailExchange = false;
  private shouldFailRefresh = false;
  private shouldFailUserInfo = false;
  private shouldFailRevoke = false;
  private exchangeError: OAuthError | null = null;
  private refreshError: OAuthError | null = null;
  private userEmail = 'test@example.com';
  private lastGeneratedState: string | null = null;
  private lastGeneratedRedirectUri: string | null = null;
  private customRefreshResponse: Partial<GoogleTokenResponse> | null = null;

  setFailNextExchange(fail: boolean, error?: OAuthError): void {
    this.shouldFailExchange = fail;
    this.exchangeError = error ?? null;
  }

  setFailNextRefresh(fail: boolean, error?: OAuthError): void {
    this.shouldFailRefresh = fail;
    this.refreshError = error ?? null;
  }

  setFailNextUserInfo(fail: boolean): void {
    this.shouldFailUserInfo = fail;
  }

  setFailNextRevoke(fail: boolean): void {
    this.shouldFailRevoke = fail;
  }

  setUserEmail(email: string): void {
    this.userEmail = email;
  }

  setCustomRefreshResponse(response: Partial<GoogleTokenResponse>): void {
    this.customRefreshResponse = response;
  }

  getLastGeneratedState(): string | null {
    return this.lastGeneratedState;
  }

  getLastGeneratedRedirectUri(): string | null {
    return this.lastGeneratedRedirectUri;
  }

  generateAuthUrl(state: string, redirectUri: string): string {
    this.lastGeneratedState = state;
    this.lastGeneratedRedirectUri = redirectUri;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  exchangeCode(
    _code: string,
    _redirectUri: string
  ): Promise<Result<GoogleTokenResponse, OAuthError>> {
    if (this.shouldFailExchange) {
      this.shouldFailExchange = false;
      return Promise.resolve(
        err(this.exchangeError ?? { code: 'TOKEN_EXCHANGE_FAILED', message: 'Exchange failed' })
      );
    }
    return Promise.resolve(
      ok({
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresIn: 3600,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        tokenType: 'Bearer',
      })
    );
  }

  refreshAccessToken(_refreshToken: string): Promise<Result<GoogleTokenResponse, OAuthError>> {
    if (this.shouldFailRefresh) {
      this.shouldFailRefresh = false;
      return Promise.resolve(
        err(
          this.refreshError ?? { code: 'TOKEN_REFRESH_FAILED', message: 'Refresh failed' }
        )
      );
    }
    if (this.customRefreshResponse !== null) {
      const response: GoogleTokenResponse = {
        accessToken: this.customRefreshResponse.accessToken ?? 'new-fake-access-token',
        refreshToken: this.customRefreshResponse.refreshToken ?? '',
        expiresIn: this.customRefreshResponse.expiresIn ?? 3600,
        scope: this.customRefreshResponse.scope ?? '',
        tokenType: this.customRefreshResponse.tokenType ?? 'Bearer',
      };
      this.customRefreshResponse = null;
      return Promise.resolve(ok(response));
    }
    return Promise.resolve(
      ok({
        accessToken: 'new-fake-access-token',
        refreshToken: 'new-fake-refresh-token',
        expiresIn: 3600,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        tokenType: 'Bearer',
      })
    );
  }

  getUserInfo(_accessToken: string): Promise<Result<GoogleUserInfo, OAuthError>> {
    if (this.shouldFailUserInfo) {
      this.shouldFailUserInfo = false;
      return Promise.resolve(
        err({ code: 'TOKEN_EXCHANGE_FAILED', message: 'Failed to get user info' })
      );
    }
    return Promise.resolve(ok({ email: this.userEmail, verified: true }));
  }

  revokeToken(_token: string): Promise<Result<void, OAuthError>> {
    if (this.shouldFailRevoke) {
      this.shouldFailRevoke = false;
      return Promise.resolve(
        err({ code: 'INTERNAL_ERROR', message: 'Revoke failed' })
      );
    }
    return Promise.resolve(ok(undefined));
  }
}

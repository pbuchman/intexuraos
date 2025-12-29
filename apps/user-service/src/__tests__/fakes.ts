/**
 * Fake repositories for user-service testing.
 *
 * These fakes implement domain port interfaces with in-memory storage.
 */
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type {
  AuthTokenRepository,
  AuthTokens,
  AuthTokensPublic,
  AuthError,
  Auth0Client,
  RefreshResult,
} from '../domain/identity/index.js';
import type {
  UserSettingsRepository,
  UserSettings,
  SettingsError,
} from '../domain/settings/index.js';

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
  private shouldFailSave = false;

  /**
   * Configure the fake to fail the next getSettings call.
   */
  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  /**
   * Configure the fake to fail the next saveSettings call.
   */
  setFailNextSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  /**
   * Store settings directly (for test setup).
   */
  setSettings(settings: UserSettings): void {
    this.settings.set(settings.userId, settings);
  }

  getSettings(userId: string): Promise<Result<UserSettings | null, SettingsError>> {
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

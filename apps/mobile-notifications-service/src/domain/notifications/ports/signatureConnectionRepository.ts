/**
 * Port for SignatureConnection persistence.
 * Implemented by infra layer (Firestore).
 */
import type { Result } from '@intexuraos/common-core';
import type { SignatureConnection, CreateSignatureConnectionInput } from '../models/index.js';

/**
 * Repository error type.
 */
export interface RepositoryError {
  code: 'INTERNAL_ERROR';
  message: string;
}

/**
 * Repository for managing signature connections (user ↔ signature token mapping).
 */
export interface SignatureConnectionRepository {
  /**
   * Save a new signature connection.
   */
  save(
    input: CreateSignatureConnectionInput
  ): Promise<Result<SignatureConnection, RepositoryError>>;

  /**
   * Find a connection by signature hash.
   */
  findBySignatureHash(hash: string): Promise<Result<SignatureConnection | null, RepositoryError>>;

  /**
   * Find all connections for a user.
   */
  findByUserId(userId: string): Promise<Result<SignatureConnection[], RepositoryError>>;

  /**
   * Delete a connection by ID.
   */
  delete(id: string): Promise<Result<void, RepositoryError>>;

  /**
   * Delete all connections for a user.
   * Used when regenerating signature to ensure only one active signature per user.
   */
  deleteByUserId(userId: string): Promise<Result<number, RepositoryError>>;

  /**
   * Check if user has any signature connections.
   */
  existsByUserId(userId: string): Promise<Result<boolean, RepositoryError>>;
}

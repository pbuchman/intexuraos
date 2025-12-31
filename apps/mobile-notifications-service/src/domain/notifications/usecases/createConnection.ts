/**
 * Use case for creating a new signature connection.
 * Generates a crypto-secure token, hashes it, and stores the hash.
 */
import { createHash, randomBytes } from 'node:crypto';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { RepositoryError, SignatureConnectionRepository } from '../ports/index.js';
import type { CreateSignatureConnectionInput } from '../models/index.js';

/**
 * Input for creating a connection.
 */
export interface CreateConnectionInput {
  userId: string;
  deviceLabel?: string;
}

/**
 * Output from creating a connection.
 */
export interface CreateConnectionOutput {
  connectionId: string;
  signature: string; // plaintext, only returned once
}

/**
 * Error from creating a connection.
 */
export interface CreateConnectionError {
  code: 'INTERNAL_ERROR';
  message: string;
}

/**
 * Generate a crypto-secure random signature token.
 * Returns 64 hex characters (32 bytes).
 */
function generateSignature(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hash a signature using SHA-256.
 */
function hashSignature(signature: string): string {
  return createHash('sha256').update(signature).digest('hex');
}

/**
 * Create a new signature connection for a user.
 * Deletes any existing signatures for the user first to ensure only one active signature.
 */
export async function createConnection(
  input: CreateConnectionInput,
  repo: SignatureConnectionRepository
): Promise<Result<CreateConnectionOutput, CreateConnectionError | RepositoryError>> {
  // Delete any existing signatures for this user (ensure single signature per user)
  const deleteResult = await repo.deleteByUserId(input.userId);
  if (!deleteResult.ok) {
    return err(deleteResult.error);
  }

  // Generate crypto-secure random signature
  const signature = generateSignature();

  // Hash for storage (plaintext never stored)
  const signatureHash = hashSignature(signature);

  // Build input with conditional deviceLabel
  const saveInput: CreateSignatureConnectionInput = {
    userId: input.userId,
    signatureHash,
  };
  if (input.deviceLabel !== undefined) {
    saveInput.deviceLabel = input.deviceLabel;
  }

  // Save to repository
  const result = await repo.save(saveInput);

  if (!result.ok) {
    return err(result.error);
  }

  return ok({
    connectionId: result.value.id,
    signature, // Return plaintext only once
  });
}

// Export hash function for use in webhook processing
export { hashSignature };

/**
 * SignatureConnection entity representing a user-signature binding.
 */
export interface SignatureConnection {
  /** Unique identifier (Firestore doc ID) */
  id: string;
  /** User who owns this connection */
  userId: string;
  /** SHA-256 hash of the signature (plaintext never stored) */
  signatureHash: string;
  /** Optional label for this device/connection */
  deviceLabel?: string;
  /** When the connection was created (ISO string) */
  createdAt: string;
}

/**
 * Input for creating a new signature connection.
 */
export interface CreateSignatureConnectionInput {
  userId: string;
  signatureHash: string;
  deviceLabel?: string;
}

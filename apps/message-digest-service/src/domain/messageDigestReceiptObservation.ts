import type { MessageDigestRun } from './models/messageDigestRun.js';

const FAILED_CONFIRMATION_OBSERVATION_MS = 7 * 24 * 60 * 60 * 1_000;

export function failedConfirmationDeadline(
  delivery: MessageDigestRun['delivery']
): {
  at: number;
  acceptedAt: string;
  confirmation: NonNullable<MessageDigestRun['delivery']['transportConfirmation']>;
} | null {
  return delivery.status === 'sent' &&
    delivery.transportConfirmation?.status === 'failed' &&
    delivery.acceptedAt !== null
    ? {
        at: Date.parse(delivery.acceptedAt) + FAILED_CONFIRMATION_OBSERVATION_MS,
        acceptedAt: delivery.acceptedAt,
        confirmation: delivery.transportConfirmation,
      }
    : null;
}

export function boundFailedConfirmationCheck(
  delivery: MessageDigestRun['delivery'],
  observedAt: string,
  nextCheckAt: string
): string | null {
  const deadline = failedConfirmationDeadline(delivery);
  if (deadline === null) return nextCheckAt;
  if (Date.parse(observedAt) >= deadline.at) return null;
  return new Date(Math.min(Date.parse(nextCheckAt), deadline.at)).toISOString();
}

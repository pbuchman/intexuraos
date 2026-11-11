import type { AppConfig } from './types/index.js';

export function resolveFeatureAvailability(
  deploymentProfile: string | undefined,
): AppConfig['featureAvailability'] {
  const profile = deploymentProfile ?? 'full';
  if (profile !== 'full' && profile !== 'basic') {
    throw new Error('Invalid public deployment capability value');
  }
  const available = profile === 'full';
  return {
    research: available,
    messageDigests: available,
    prTriage: available,
    schedulers: available,
  };
}

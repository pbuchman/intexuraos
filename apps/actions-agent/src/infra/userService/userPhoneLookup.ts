import type { UserPhoneLookup } from '../../domain/ports/userPhoneLookup.js';

export interface UserPhoneLookupConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export function createUserPhoneLookup(config: UserPhoneLookupConfig): UserPhoneLookup {
  return {
    async getPhoneNumber(userId: string): Promise<string | null> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/users/${userId}/whatsapp-phone`, {
          method: 'GET',
          headers: {
            'x-internal-auth': config.internalAuthToken,
            'content-type': 'application/json',
          },
        });

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          return null;
        }

        const body = (await response.json()) as { phoneNumber: string };
        return body.phoneNumber;
      } catch {
        return null;
      }
    },
  };
}

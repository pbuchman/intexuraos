/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly INTEXURAOS_AUTH0_DOMAIN: string;
  readonly INTEXURAOS_AUTH0_SPA_CLIENT_ID: string;
  readonly INTEXURAOS_AUTH_AUDIENCE: string;
  readonly INTEXURAOS_USER_SERVICE_URL: string;
  readonly INTEXURAOS_PROMPTVAULT_SERVICE_URL: string;
  readonly INTEXURAOS_WHATSAPP_SERVICE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Virtual module from vite-plugin-pwa
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

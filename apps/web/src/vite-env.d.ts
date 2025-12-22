/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH_AUDIENCE: string;
  readonly VITE_AUTH_SERVICE_URL: string;
  readonly VITE_PROMPTVAULT_SERVICE_URL: string;
  readonly VITE_WHATSAPP_SERVICE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

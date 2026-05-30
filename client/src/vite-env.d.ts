// Fix: Removed problematic reference to vite/client to resolve build error.
// The interfaces below provide the necessary type definitions for import.meta.env.

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Tipos do vite-plugin-pwa (declarados manualmente para não puxar vite/client).
declare module 'virtual:pwa-register/react' {
  import type { Dispatch, SetStateAction } from 'react';
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: any) => void;
  }
  export function useRegisterSW(options?: RegisterSWOptions): {
    needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
    offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}

// Fix: Removed problematic reference to vite/client to resolve build error.
// The interfaces below provide the necessary type definitions for import.meta.env.

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

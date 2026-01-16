// Reference to vite/client removed to resolve type definition error
// Manual declarations added for assets and environment variables

declare module '*.css';
declare module '*.png';
declare module '*.svg' {
  import * as React from 'react';
  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
  const src: string;
  export default src;
}
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  url: string;
}
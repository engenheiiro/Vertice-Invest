import { replayIntegration } from '@sentry/react';

/**
 * Session Replay em chunk separado do núcleo do Sentry (ver `sentryClient.ts`):
 * baixa só depois do init, sem atrasar o boot nem a captura de erros.
 */
export const createReplayIntegration = () =>
  replayIntegration({
    maskAllText: true,
    blockAllMedia: true,
  });

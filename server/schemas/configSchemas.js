import { z } from 'zod';

// Espelha TUNABLE_DEFS de configService.js — faixas sincronizadas à mão.
// Usar .strict() para rejeitar chaves desconhecidas antes de chegar ao serviço.
export const tunablesPatchSchema = z.object({
  body: z.object({
    maxCryptoPerProfile: z.coerce
      .number({ invalid_type_error: 'maxCryptoPerProfile deve ser um número' })
      .int('maxCryptoPerProfile deve ser inteiro')
      .min(0, 'maxCryptoPerProfile mínimo é 0')
      .max(10, 'maxCryptoPerProfile máximo é 10')
      .optional(),
    marketCacheMinutes: z.coerce
      .number({ invalid_type_error: 'marketCacheMinutes deve ser um número' })
      .int('marketCacheMinutes deve ser inteiro')
      .min(1, 'marketCacheMinutes mínimo é 1')
      .max(1440, 'marketCacheMinutes máximo é 1440')
      .optional(),
    defaultSelicFallback: z.coerce
      .number({ invalid_type_error: 'defaultSelicFallback deve ser um número' })
      .min(0, 'defaultSelicFallback mínimo é 0%')
      .max(100, 'defaultSelicFallback máximo é 100%')
      .optional(),
  })
  .strict('Parâmetro desconhecido enviado.')
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Informe ao menos um parâmetro para atualizar.' },
  ),
});

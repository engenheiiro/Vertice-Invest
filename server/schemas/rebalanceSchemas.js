import { z } from 'zod';

// POST /wallet/rebalance — gera o plano de rebalanceamento (read-only) para o
// perfil de risco escolhido. Default MODERATE quando o corpo vem vazio.
export const rebalanceSchema = z.object({
  body: z.object({
    riskProfile: z
      .enum(['DEFENSIVE', 'MODERATE', 'BOLD'], {
        error: 'Perfil de risco inválido',
      })
      .optional()
      .default('MODERATE'),
  }),
});

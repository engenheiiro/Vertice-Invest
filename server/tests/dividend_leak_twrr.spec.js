import { describe, it, expect } from 'vitest';
import { calculateDailyDietz } from '../utils/mathUtils.js';

// Regressão do "vazamento de proventos" na cota (TWRR): no dia-ex o preço cai,
// mas o provento recebido é RENDA e deve compensar essa queda. Sem creditá-lo, a
// cota registra a distribuição como prejuízo permanente e a carteira parece plana.
describe('calculateDailyDietz — crédito de proventos (income)', () => {
    it('sem provento: dia-ex de FII vira prejuízo (comportamento antigo)', () => {
        // FII a 10,00 distribui 0,10/cota → preço abre a 9,90 no dia-ex.
        // 100 cotas: equity 1000 → 990, sem fluxo. Retorno "cru" = -1%.
        const r = calculateDailyDietz(1000, 990, 0);
        expect(r).toBeCloseTo(-0.01, 6);
    });

    it('com provento: o dividendo do dia neutraliza a queda do dia-ex', () => {
        // Mesma queda de preço (1000→990), mas R$ 10 de proventos (100 cotas × 0,10).
        // Retorno total do dia ≈ 0 — o investidor não perdeu nada.
        const r = calculateDailyDietz(1000, 990, 0, 10);
        expect(r).toBeCloseTo(0, 6);
    });

    it('provento acima da queda de preço → retorno positivo no dia', () => {
        const r = calculateDailyDietz(1000, 990, 0, 15);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeCloseTo(0.005, 6); // (990 + 15 - 1000) / 1000
    });

    it('income default = 0 mantém retrocompatibilidade', () => {
        expect(calculateDailyDietz(1000, 1010, 0)).toBeCloseTo(0.01, 6);
        expect(calculateDailyDietz(1000, 1010, 0, 0)).toBeCloseTo(0.01, 6);
    });

    it('aporte + provento no mesmo dia (Modified Dietz peso 0.5)', () => {
        // start 1000, aporte 500 (peso 0.5 → base 1250), equity 1490, provento 10.
        // numerador = 1490 + 10 - 1000 - 500 = 0 → retorno ~0.
        const r = calculateDailyDietz(1000, 1490, 500, 10);
        expect(r).toBeCloseTo(0, 6);
    });

    it('primeiro dia (sem patrimônio inicial) credita o provento no aporte', () => {
        // Comprou 1000 no dia e já veio um provento de 5 no mesmo dia.
        const r = calculateDailyDietz(0, 1000, 1000, 5);
        expect(r).toBeCloseTo(0.005, 6); // (1000 + 5 - 1000) / 1000
    });

    it('efeito cumulativo: ~1%/mês de proventos deixa de derreter a cota', () => {
        // 24 meses de distribuição de FII sem variação de preço.
        let quotaLeak = 100;   // sem crédito (antigo)
        let quotaFixed = 100;  // com crédito (novo)
        for (let m = 0; m < 24; m++) {
            // preço volta a 1000 no fim do mês, mas caiu para 990 no dia-ex.
            quotaLeak *= 1 + calculateDailyDietz(1000, 990, 0);
            quotaFixed *= 1 + calculateDailyDietz(1000, 990, 0, 10);
        }
        expect(quotaLeak).toBeLessThan(80);      // vazamento derrete >20%
        expect(quotaFixed).toBeCloseTo(100, 1);  // cota preservada
    });
});

import { describe, it, expect } from 'vitest';
import {
    resolveRateInputs,
    nominalLongRate,
    expectedRateForType,
    suggestExpectedRate,
    annualizeReturn,
    annualizedWalletReturn,
    rateDrift,
} from '../utils/goalRate.js';
import {
    GOAL_PREMIUM_EQUITY,
    GOAL_PREMIUM_FII,
    GOAL_RATE_SANITY_CAP,
    DEFAULT_SELIC_FALLBACK,
} from '../config/financialConstants.js';

// Macro de referência: o estado real do SystemConfig em 08/09/2026.
const MACRO = { cdi: 13.9, selic: 14, ipca: 4.44, ntnbLong: 7.81 };

describe('goalRate', () => {
    describe('resolveRateInputs', () => {
        it('usa o CDI quando existe', () => {
            expect(resolveRateInputs(MACRO).cdi).toBe(13.9);
        });

        it('cai na Selic quando o CDI falta (diferença de décimos, não de regime)', () => {
            expect(resolveRateInputs({ selic: 14 }).cdi).toBe(14);
        });

        it('macro vazio cai nos fallbacks explícitos', () => {
            expect(resolveRateInputs({}).cdi).toBe(DEFAULT_SELIC_FALLBACK);
            expect(resolveRateInputs(undefined).cdi).toBe(DEFAULT_SELIC_FALLBACK);
        });
    });

    describe('nominalLongRate', () => {
        it('compõe NTN-B (real) com IPCA em vez de somar', () => {
            // (1,0781 × 1,0444) − 1 = 12,60% — somar daria 12,25%.
            expect(nominalLongRate(MACRO)).toBeCloseTo(12.6, 1);
            expect(nominalLongRate(MACRO)).toBeGreaterThan(MACRO.ntnbLong + MACRO.ipca);
        });
    });

    describe('expectedRateForType', () => {
        const inputs = resolveRateInputs(MACRO);
        const floor = nominalLongRate(inputs);

        it('caixa e renda fixa rendem CDI', () => {
            expect(expectedRateForType('CASH', inputs)).toBe(13.9);
            expect(expectedRateForType('FIXED_INCOME', inputs)).toBe(13.9);
        });

        it('renda variável ganha prêmio sobre o juro nominal longo', () => {
            expect(expectedRateForType('STOCK', inputs)).toBeCloseTo(floor + GOAL_PREMIUM_EQUITY, 6);
            expect(expectedRateForType('ETF', inputs)).toBeCloseTo(floor + GOAL_PREMIUM_EQUITY, 6);
            expect(expectedRateForType('FII', inputs)).toBeCloseTo(floor + GOAL_PREMIUM_FII, 6);
        });

        it('FII tem prêmio MENOR que ação (parte do retorno é aluguel contratado)', () => {
            expect(expectedRateForType('FII', inputs)).toBeLessThan(expectedRateForType('STOCK', inputs));
        });

        it('cripto e classe desconhecida não ganham prêmio nenhum', () => {
            expect(expectedRateForType('CRYPTO', inputs)).toBeCloseTo(floor, 6);
            expect(expectedRateForType('SEI_LA_O_QUE', inputs)).toBeCloseTo(floor, 6);
            expect(expectedRateForType(null, inputs)).toBeCloseTo(floor, 6);
        });
    });

    describe('suggestExpectedRate', () => {
        it('carteira 100% caixa sugere o CDI', () => {
            expect(suggestExpectedRate({ CASH: 10_000 }, MACRO).rate).toBe(13.9);
        });

        it('carteira 100% ações sugere nominal longo + prêmio de renda variável', () => {
            const { rate } = suggestExpectedRate({ STOCK: 10_000 }, MACRO);
            expect(rate).toBeCloseTo(nominalLongRate(resolveRateInputs(MACRO)) + GOAL_PREMIUM_EQUITY, 1);
        });

        it('pondera pelo valor de mercado, não pelo número de classes', () => {
            // 90% caixa + 10% ações fica perto do CDI, não no meio do caminho.
            const { rate } = suggestExpectedRate({ CASH: 90_000, STOCK: 10_000 }, MACRO);
            const cash = suggestExpectedRate({ CASH: 1 }, MACRO).rate;
            const stock = suggestExpectedRate({ STOCK: 1 }, MACRO).rate;
            expect(rate).toBeGreaterThan(cash);
            expect(rate).toBeLessThan((cash + stock) / 2);
        });

        it('carteira real (91% caixa) sugere ~14% — o CDI vizinho', () => {
            const { rate, breakdown } = suggestExpectedRate(
                { CASH: 42_090, ETF: 2_068, FIXED_INCOME: 1_108, FII: 636, STOCK: 146, CRYPTO: 41 },
                MACRO,
            );
            expect(rate).toBeGreaterThan(13.5);
            expect(rate).toBeLessThan(14.5);
            // Ordenado por valor: a maior classe primeiro, e os pesos somam 1.
            expect(breakdown[0].type).toBe('CASH');
            expect(breakdown.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 6);
        });

        it('carteira vazia cai no CDI (é onde o dinheiro fica antes de investir)', () => {
            const empty = suggestExpectedRate({}, MACRO);
            expect(empty.rate).toBe(13.9);
            expect(empty.total).toBe(0);
            expect(empty.breakdown).toEqual([]);
        });

        it('ignora classes zeradas e valores inválidos', () => {
            const { breakdown } = suggestExpectedRate({ CASH: 100, STOCK: 0, FII: null, ETF: undefined }, MACRO);
            expect(breakdown.map((b) => b.type)).toEqual(['CASH']);
        });
    });

    describe('annualizeReturn', () => {
        it('NÃO devolve taxa com janela curta — o defeito que este módulo mata', () => {
            // +12% em 62 dias equivale a ~90% a.a.; o formulário colava "12% a.a.".
            const r = annualizeReturn(12, 62);
            expect(r.enough).toBe(false);
            expect(r.value).toBeNull();
        });

        it('+96,44% em 5 anos vira ~14,5% a.a., não 96%', () => {
            const r = annualizeReturn(96.44, 1825);
            expect(r.enough).toBe(true);
            expect(r.value).toBeGreaterThan(14);
            expect(r.value).toBeLessThan(15);
        });

        it('1 ano de retorno excepcional é limitado pelo teto de sanidade', () => {
            const r = annualizeReturn(60, 365);
            expect(r.capped).toBe(true);
            expect(r.value).toBe(GOAL_RATE_SANITY_CAP);
        });

        it('janela exatamente no mínimo já vale', () => {
            expect(annualizeReturn(5, 180).enough).toBe(true);
            expect(annualizeReturn(5, 179).enough).toBe(false);
        });

        it('retorno negativo devolve taxa negativa (sem inventar otimismo)', () => {
            const r = annualizeReturn(-10, 365);
            expect(r.enough).toBe(true);
            expect(r.value).toBeCloseTo(-10, 1);
        });

        it('perda total e entradas inválidas não viram taxa', () => {
            expect(annualizeReturn(-100, 365).enough).toBe(false);
            expect(annualizeReturn(10, 0).enough).toBe(false);
            expect(annualizeReturn(10, -5).enough).toBe(false);
            expect(annualizeReturn(NaN, 365).enough).toBe(false);
        });
    });

    describe('annualizedWalletReturn', () => {
        const day = (iso, quotaPrice) => ({ date: new Date(iso), quotaPrice });

        it('usa a COTA (imune a aportes), não o patrimônio', () => {
            // Cota +10% em 365 dias = 10% a.a., mesmo com o patrimônio triplicando.
            const r = annualizedWalletReturn([day('2025-09-08', 100), day('2026-09-08', 110)]);
            expect(r.value).toBeCloseTo(10, 1);
        });

        it('série curta demais não vira taxa', () => {
            expect(annualizedWalletReturn([day('2026-07-07', 100), day('2026-09-05', 112)]).enough).toBe(false);
        });

        it('sem histórico suficiente devolve enough=false em vez de explodir', () => {
            expect(annualizedWalletReturn([]).enough).toBe(false);
            expect(annualizedWalletReturn([day('2026-09-08', 100)]).enough).toBe(false);
            expect(annualizedWalletReturn(undefined).enough).toBe(false);
        });

        it('descarta snapshot sem cota', () => {
            const r = annualizedWalletReturn([day('2025-09-08', 0), day('2025-09-08', 100), day('2026-09-08', 110)]);
            expect(r.value).toBeCloseTo(10, 1);
        });
    });

    describe('rateDrift', () => {
        it('13,9% salvo contra 14,0% sugerido é ruído, não divergência', () => {
            expect(rateDrift(13.9, 14)).toEqual({ deltaPp: -0.1, stale: false });
        });

        it('acusa premissa envelhecida quando os juros caem', () => {
            const d = rateDrift(13.9, 9.5);
            expect(d.deltaPp).toBe(4.4);
            expect(d.stale).toBe(true);
        });

        it('acusa nos dois sentidos (meta pessimista também é premissa errada)', () => {
            expect(rateDrift(10, 16).stale).toBe(true);
        });

        it('exatamente na tolerância ainda não é divergência', () => {
            expect(rateDrift(12, 10, 2).stale).toBe(false);
            expect(rateDrift(12.1, 10, 2).stale).toBe(true);
        });
    });
});

/**
 * "Variação Hoje" tem de fechar com o patrimônio: a identidade
 *
 *     patrimônio do snapshot-âncora + Variação Hoje === patrimônio de hoje
 *
 * Estes testes travam os três vãos que a quebravam numa carteira real em
 * 01/09/2026, quando a tela mostrou "Variação Hoje +R$ 7,97" com o Patrimônio
 * Líquido R$ 8,14 MENOR que o de ontem — um buraco de R$ 16,11:
 *
 *  1) R$ 9,65 — o rebuild rendia a renda fixa no PRÓPRIO dia da aplicação, e
 *     `accrueFixedIncomeValue` (KPI ao vivo e snapshot diário) só a partir do dia
 *     seguinte. Toda a série ficava um dia útil adiantada, e como o rebuild roda a
 *     cada transação salva, o patrimônio de ontem nascia maior que o de hoje.
 *  2) R$ 5,34 — seis FIIs ficaram ex-provento, o provedor baixou
 *     `regularMarketPreviousClose` pelo provento e o candle gravado guardou o
 *     fechamento cheio. A queda do dia-ex entrava no patrimônio e sumia da variação.
 *  3) R$ 1,12 — cripto negocia 24h: o `previousClose` do provedor e o candle
 *     gravado cortam o dia em horas diferentes.
 */
import { describe, it, expect } from 'vitest';
import { processWalletAsset } from '../controllers/walletController.js';
import { financialService } from '../services/financialService.js';
import { accrueFixedIncomeValue, accrueLotsValue } from '../utils/fixedIncome.js';
import { buildCdiCurve, annualRateFromDailyFactor, EMPTY_CDI_CURVE } from '../utils/cdiCurve.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { safeValue, safeDiv, safeMult, percentOf } from '../utils/mathUtils.js';

const macroRates = { cdiRate: 13.9, selic: 14.0, ipca: 4.72 };
const HOJE = '2026-09-01';
const ANCORA = '2026-08-31';

const baseCtx = (overrides = {}) => ({
    assetMap: new Map(),
    usdRate: 5.185,
    usdChange: 0.4436,
    macroRates,
    isTodayBusinessDay: true,
    todayKey: HOJE,
    anchorDayKey: ANCORA,
    anchorCloses: new Map(),
    anchorUsdRate: 0,
    ...overrides,
});

// Valor da posição no início do dia, em BRL — é o número que TEM de bater com o
// que o snapshot-âncora gravou.
const valorInicioBr = (r) => r.totalValueBr - r.dayChangeValueBr;

describe('renda fixa: rebuild e KPI ao vivo rendem os MESMOS dias úteis', () => {
    const COMPRA = '2026-08-26'; // quarta-feira
    const VALOR = 10_000;
    const cdiDailyFactor = Math.pow(1 + macroRates.cdiRate / 100, 1 / 252);

    const asset = {
        ticker: 'RESERVA',
        type: 'CASH',
        quantity: VALOR,
        totalCost: VALOR,
        fixedIncomeRate: 100, // 100% do CDI
        taxLots: [{ date: new Date(`${COMPRA}T00:00:00.000Z`), quantity: VALOR, price: 1 }],
    };

    // Roda o loop diário do rebuild (transações → accrual) e devolve o valor da
    // renda fixa em cada dia, exatamente como `rebuildUserHistory` faz.
    const rebuildAte = (ateDia) => {
        const txs = [{
            ticker: 'RESERVA', type: 'BUY', quantity: VALOR, price: 1, totalValue: VALOR,
            currency: 'BRL', date: new Date(`${COMPRA}T12:00:00.000Z`),
        }];
        const assetMetadataMap = new Map([['RESERVA', { ticker: 'RESERVA', type: 'CASH', fixedIncomeRate: 100 }]]);
        const portfolio = {};
        const fixedIncomeState = {};
        const porDia = new Map();
        let txIndex = 0;

        const cursor = new Date(`${COMPRA}T12:00:00.000Z`);
        const fim = new Date(`${ateDia}T12:00:00.000Z`);
        while (cursor <= fim) {
            const cursorIso = cursor.toISOString().slice(0, 10);
            ({ txIndex } = financialService._applyDayTransactions({
                txs, txIndex, cursorIso, portfolio, fixedIncomeState,
                assetMetadataMap, priceCacheMap: new Map(), lastKnownPrices: {},
                getUsdRateForDate: () => 5.185,
            }));
            financialService._accrueDailyFixedIncome({
                cursor, cursorIso, portfolio, fixedIncomeState,
                dailyFactorsMap: new Map(), cdiDailyFactor, currentIpcaRate: macroRates.ipca,
            });
            porDia.set(cursorIso, fixedIncomeState.RESERVA.currentValue);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return porDia;
    };

    const aoVivo = (dia) => accrueFixedIncomeValue(asset, {
        ...macroRates, calcDate: new Date(`${dia}T00:00:00.000Z`),
    });

    it('aplicação não rende no próprio dia (mesma régua de countBusinessDays)', () => {
        expect(rebuildAte(COMPRA).get(COMPRA)).toBeCloseTo(VALOR, 6);
        expect(aoVivo(COMPRA)).toBeCloseTo(VALOR, 6);
    });

    it('rebuild e KPI ao vivo batem em TODO dia da série', () => {
        const porDia = rebuildAte(ANCORA);
        for (const [dia, valorRebuild] of porDia) {
            expect(valorRebuild, `divergência em ${dia}`).toBeCloseTo(aoVivo(dia), 6);
        }
        // A série cobre um fim de semana (29–30/08): o accrual só anda em dia útil.
        expect(porDia.get('2026-08-28')).toBeCloseTo(porDia.get('2026-08-30'), 10);
    });

    it('um dia útil de defasagem na série de R$ 19 mil vale ~R$ 9,65', () => {
        // Ordem de grandeza do defeito original: é isto que a paridade acima evita
        // que volte silenciosamente.
        const umDia = 19_000 * (Math.pow(1 + macroRates.cdiRate / 100, 1 / 252) - 1);
        expect(umDia).toBeGreaterThan(9);
        expect(umDia).toBeLessThan(10.5);
    });
});

describe('dia-ex: a âncora é o candle gravado, não a referência ajustada do provedor', () => {
    // TRXF11 real: 2 cotas, fechamento de 31/08 a R$ 79,30. O fundo distribuiu
    // R$ 0,93/cota com ex-date em 01/09, e o Yahoo devolveu previousClose 78,37 —
    // o fechamento MENOS o provento.
    const trxf = {
        ticker: 'TRXF11', type: 'FII', quantity: 2, totalCost: 150,
        taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 2, price: 75 }],
    };
    const cotacao = { price: 75.66, previousClose: 78.37, change: -3.458, priceDate: HOJE };

    it('usa o fechamento cheio do candle como início do dia', () => {
        const r = processWalletAsset(trxf, baseCtx({
            assetMap: new Map([['TRXF11', cotacao]]),
            anchorCloses: new Map([['TRXF11', 79.30]]),
        }));
        expect(valorInicioBr(r)).toBeCloseTo(2 * 79.30, 6);
        // A queda do dia-ex aparece INTEIRA na variação, como aparece no patrimônio.
        expect(r.dayChangeValueBr).toBeCloseTo(2 * (75.66 - 79.30), 6);
    });

    it('sem candle no dia-âncora, mantém o caminho antigo (não regride)', () => {
        const r = processWalletAsset(trxf, baseCtx({
            assetMap: new Map([['TRXF11', cotacao]]),
            anchorCloses: new Map(),
        }));
        expect(valorInicioBr(r)).toBeCloseTo(2 * 78.37, 4);
    });

    it('posição comprada hoje ancora no custo, não no candle', () => {
        const compradaHoje = {
            ...trxf,
            totalCost: 151.32,
            taxLots: [{ date: new Date(`${HOJE}T00:00:00.000Z`), quantity: 2, price: 75.66 }],
        };
        const r = processWalletAsset(compradaHoje, baseCtx({
            assetMap: new Map([['TRXF11', cotacao]]),
            anchorCloses: new Map([['TRXF11', 79.30]]),
        }));
        expect(valorInicioBr(r)).toBeCloseTo(151.32, 4);
        expect(r.dayChangeValueBr).toBeCloseTo(0, 4);
    });
});

describe('cripto: âncora no candle, não na janela do provedor', () => {
    const btc = {
        ticker: 'BTC', type: 'CRYPTO', currency: 'USD', quantity: 0.0005014, totalCost: 35,
        taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 0.0005014, price: 70000 }],
    };

    it('o candle de 31/08 vence o previousClose deslizante de 24h', () => {
        const r = processWalletAsset(btc, baseCtx({
            assetMap: new Map([['BTC', { price: 77_395.89 * 0.98, previousClose: 77_395.89, change: 1.18, priceDate: HOJE }]]),
            // A série grava BTC-USD, não BTC — a chave é a de armazenamento.
            anchorCloses: new Map([[historyStorageKey('BTC', 'CRYPTO'), 78_548.63]]),
            anchorUsdRate: 5.16,
        }));
        // safeValue arredonda o valor NATIVO a 2 casas antes do câmbio — a mesma
        // aritmética de computeEquityAt, que é quem gravou o snapshot.
        expect(valorInicioBr(r)).toBeCloseTo(safeValue(0.0005014, 78_548.63) * 5.16, 4);
    });

    it('câmbio do início do dia é o do dia-âncora, não o reconstruído pelo change', () => {
        const ctx = baseCtx({
            assetMap: new Map([['BTC', { price: 78_548.63, previousClose: 78_548.63, change: 0, priceDate: HOJE }]]),
            anchorCloses: new Map([[historyStorageKey('BTC', 'CRYPTO'), 78_548.63]]),
            anchorUsdRate: 5.16,
        });
        const r = processWalletAsset(btc, ctx);
        // Preço parado, câmbio subindo: a variação é só cambial e usa a taxa do
        // dia-âncora (5,16), não 5,185 / 1,004436.
        expect(r.dayChangeValueBr).toBeCloseTo(safeValue(0.0005014, 78_548.63) * (5.185 - 5.16), 6);
    });
});

describe('identidade: soma das variações === patrimônio de hoje − patrimônio do âncora', () => {
    it('fecha ao centavo numa carteira mista em dia-ex', () => {
        const posicoes = [
            { asset: { ticker: 'TRXF11', type: 'FII', quantity: 2, totalCost: 150, taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 2, price: 75 }] },
              close: 79.30, quote: { price: 75.66, previousClose: 78.37, change: -3.458, priceDate: HOJE } },
            { asset: { ticker: 'PETR4', type: 'STOCK', quantity: 1, totalCost: 40, taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 1, price: 40 }] },
              close: 45.02, quote: { price: 46.87, previousClose: 45.02, change: 4.109, priceDate: HOJE } },
            { asset: { ticker: 'BOVA11', type: 'ETF', quantity: 7, totalCost: 1200, taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 7, price: 171.43 }] },
              close: 174.78, quote: { price: 177.10, previousClose: 174.78, change: 1.327, priceDate: HOJE } },
        ];
        const ctx = baseCtx({
            assetMap: new Map(posicoes.map((p) => [p.asset.ticker, p.quote])),
            anchorCloses: new Map(posicoes.map((p) => [historyStorageKey(p.asset.ticker, p.asset.type), p.close])),
        });

        let equityHoje = 0;
        let variacao = 0;
        for (const p of posicoes) {
            const r = processWalletAsset(p.asset, ctx);
            equityHoje += r.totalValueBr;
            variacao += r.dayChangeValueBr;
        }
        // Patrimônio do âncora pela MESMA marcação do snapshot: quantidade × candle.
        const equityAncora = posicoes.reduce((acc, p) => acc + p.asset.quantity * p.close, 0);

        expect(equityAncora + variacao).toBeCloseTo(equityHoje, 6);
    });
});

describe('percentual: a razão não pode ser arredondada antes de virar percentual', () => {
    it('R$ 1,58 sobre R$ 22.148 é 0,007%, não 0,01%', () => {
        // `safeDiv` arredonda a RAZÃO a 4 casas (0,00007134 → 0,0001), e o percentual
        // saía 40% maior — com todo percentual do sistema quantizado em 0,01.
        expect(percentOf(1.58, 22_148.20)).toBeCloseTo(0.0071, 4);
        expect(safeMult(safeDiv(1.58, 22_148.20), 100)).toBe(0.01); // o defeito
    });

    it('preserva a precisão de percentuais grandes', () => {
        expect(percentOf(301.21, 21_856.44)).toBeCloseTo(1.3781, 4);
    });

    it('denominador zero, ausente ou inválido devolve 0 em vez de Infinity/NaN', () => {
        expect(percentOf(10, 0)).toBe(0);
        expect(percentOf(10, null)).toBe(0);
        expect(percentOf(NaN, 100)).toBe(0);
    });
});

describe('curva do CDI: cada dia rende pela taxa que estava vigente NAQUELE dia', () => {
    // Dois regimes reais da série SELIC em 2026: 14,15% a.a. até a queda, 13,90%
    // depois. Fatores diários como o banco grava (`accumulatedFactor`).
    const F_1415 = Math.pow(1 + 14.15 / 100, 1 / 252);
    const F_1390 = Math.pow(1 + 13.90 / 100, 1 / 252);
    const dias = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31'];
    const curva = buildCdiCurve(
        dias.map((d, i) => ({ date: new Date(`${d}T00:00:00.000Z`), accumulatedFactor: i < 2 ? F_1415 : F_1390 })),
        { currentRate: 13.90 },
    );

    it('o fator diário gravado volta como a taxa anual que o gerou', () => {
        expect(annualRateFromDailyFactor(F_1415)).toBeCloseTo(14.15, 6);
        expect(annualRateFromDailyFactor(F_1390)).toBeCloseTo(13.90, 6);
        expect(annualRateFromDailyFactor(0)).toBeNull();
        expect(annualRateFromDailyFactor('lixo')).toBeNull();
    });

    it('dia fora da série cai no CDI do ano, e depois na taxa corrente', () => {
        expect(curva.annualRateFor('2026-08-27')).toBeCloseTo(14.15, 6);
        expect(curva.annualRateFor('2020-03-10')).toBe(2.77); // HISTORICAL_CDI_RATES
        expect(curva.annualRateFor('2026-01-05')).toBe(13.90); // ano corrente → taxa viva
    });

    it('compor com a curva difere de compor com a taxa de hoje', () => {
        const lotes = [{ date: new Date('2026-08-25T00:00:00.000Z'), principal: 18_164 }];
        const spec = { fixedIncomeRate: 100 };
        const opts = { cdiRate: 13.90, ipca: 4.72, endDate: new Date('2026-08-31T00:00:00.000Z') };

        const comCurva = accrueLotsValue(lotes, spec, { ...opts, cdiCurve: curva });
        const semCurva = accrueLotsValue(lotes, spec, opts);

        // A janela cobre dois dias no regime antigo (mais alto): a curva rende MAIS.
        expect(comCurva).toBeGreaterThan(semCurva);
        expect(comCurva - semCurva).toBeGreaterThan(0);
    });

    it('rebuild e KPI ao vivo batem em TODO dia, agora com a curva', () => {
        const COMPRA = '2026-08-26';
        const VALOR = 10_000;
        const asset = {
            ticker: 'RESERVA', type: 'CASH', quantity: VALOR, totalCost: VALOR, fixedIncomeRate: 100,
            taxLots: [{ date: new Date(`${COMPRA}T00:00:00.000Z`), quantity: VALOR, price: 1 }],
        };
        const txs = [{
            ticker: 'RESERVA', type: 'BUY', quantity: VALOR, price: 1, totalValue: VALOR,
            currency: 'BRL', date: new Date(`${COMPRA}T12:00:00.000Z`),
        }];
        const assetMetadataMap = new Map([['RESERVA', { ticker: 'RESERVA', type: 'CASH', fixedIncomeRate: 100 }]]);
        const portfolio = {};
        const fixedIncomeState = {};
        let txIndex = 0;

        const cursor = new Date(`${COMPRA}T12:00:00.000Z`);
        const fim = new Date('2026-08-31T12:00:00.000Z');
        while (cursor <= fim) {
            const cursorIso = cursor.toISOString().slice(0, 10);
            ({ txIndex } = financialService._applyDayTransactions({
                txs, txIndex, cursorIso, portfolio, fixedIncomeState,
                assetMetadataMap, priceCacheMap: new Map(), lastKnownPrices: {},
                getUsdRateForDate: () => 5.185,
            }));
            financialService._accrueDailyFixedIncome({
                cursor, cursorIso, portfolio, fixedIncomeState,
                dailyFactorsMap: new Map(), cdiDailyFactor: F_1390,
                currentCdiRate: 13.90, currentSelicRate: 14.0, currentIpcaRate: 4.72,
                cdiCurve: curva,
            });

            const aoVivo = accrueFixedIncomeValue(asset, {
                cdiRate: 13.90, selic: 14.0, ipca: 4.72,
                calcDate: new Date(`${cursorIso}T00:00:00.000Z`), cdiCurve: curva,
            });
            expect(fixedIncomeState.RESERVA.currentValue, `divergência em ${cursorIso}`).toBeCloseTo(aoVivo, 8);

            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    });

    it('curva vazia devolve o comportamento anterior (taxa corrente em todo dia)', () => {
        const lotes = [{ date: new Date('2026-08-25T00:00:00.000Z'), principal: 1000 }];
        const spec = { fixedIncomeRate: 100 };
        const opts = { cdiRate: 13.90, ipca: 4.72, endDate: new Date('2026-08-31T00:00:00.000Z') };
        expect(accrueLotsValue(lotes, spec, { ...opts, cdiCurve: EMPTY_CDI_CURVE }))
            .toBeCloseTo(accrueLotsValue(lotes, spec, opts), 10);
    });
});

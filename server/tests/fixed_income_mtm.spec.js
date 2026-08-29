/**
 * Marcação a mercado da renda fixa: razão de PU, fallback para accrual e paridade
 * com o card da carteira.
 *
 * O invariante mais importante daqui é a INVARIÂNCIA À CONVENÇÃO DE QUANTIDADE.
 * `quantity`/`price` de renda fixa não seguem padrão nas posições reais — existe
 * Tesouro IPCA+ 2032 cadastrado como 2 × R$87,86 num título cujo PU passa de
 * R$3.000. Marcar por quantidade × PU multiplicaria o patrimônio por dezenas; a
 * marcação por razão só usa o custo e a variação percentual oficial.
 */
import { describe, it, expect } from 'vitest';
import {
    findTreasuryPu,
    markToMarketFixedIncome,
    valueFixedIncomeAsset,
    accrueFixedIncomeValue,
    normalizeLots,
    PRICING_SOURCE,
    MAX_PU_STALE_DAYS,
    brazilToday,
} from '../utils/fixedIncome.js';
import { processWalletAsset } from '../controllers/walletController.js';
import { safeCurrency } from '../utils/mathUtils.js';

const macroRates = { cdiRate: 14.15, selic: 14.25, ipca: 4.72 };

// Datas ancoradas em "hoje" e não em literais: a janela de defasagem do PU
// (MAX_PU_STALE_DAYS) é relativa, então fixture com data fixa passaria a cair no
// accrual sozinha alguns dias depois de escrita.
const DAY_MS = 86400000;
const dayIso = (offset) => new Date(brazilToday().getTime() + offset * DAY_MS).toISOString().slice(0, 10);
const dayDate = (offset) => new Date(`${dayIso(offset)}T00:00:00.000Z`);

const D4 = dayIso(-4); // dia da compra
const D2 = dayIso(-2);
const D1 = dayIso(-1);
const D0 = dayIso(0);  // hoje: último PU publicado

// Série sintética: PU de venda sobe ~11% entre a compra e hoje.
const history = [
    { date: D4, pu: 1000, puBuy: 1010 },
    { date: dayIso(-3), pu: 1020, puBuy: 1030 },
    { date: D2, pu: 1050, puBuy: 1060 },
    { date: D1, pu: 1080, puBuy: 1090 },
    { date: D0, pu: 1111, puBuy: 1121 },
];

const asset = (over = {}) => ({
    type: 'FIXED_INCOME',
    ticker: 'TESOURO IPCA+ 2035',
    name: 'Tesouro IPCA+ 2035',
    quantity: 1,
    totalCost: 1000,
    currency: 'BRL',
    taxLots: [{ date: dayDate(-4), quantity: 1, price: 1000 }],
    ...over,
});

const calcDate = brazilToday();

describe('findTreasuryPu', () => {
    it('devolve o PU do próprio dia', () => {
        expect(findTreasuryPu(history, D2).point.pu).toBe(1050);
    });

    it('cai no último pregão anterior quando o dia não tem publicação', () => {
        expect(findTreasuryPu(history, dayIso(1)).point.pu).toBe(1111);
    });

    it('devolve null antes do início da série (nunca extrapola para trás)', () => {
        expect(findTreasuryPu(history, dayIso(-5))).toBeNull();
    });

    it('devolve null quando o ponto encontrado está velho demais', () => {
        expect(findTreasuryPu(history, dayIso(MAX_PU_STALE_DAYS + 1))).toBeNull();
        // Exatamente no limite ainda vale.
        expect(findTreasuryPu(history, dayIso(MAX_PU_STALE_DAYS)).point.pu).toBe(1111);
    });

    it('série vazia ou data inválida não quebra', () => {
        expect(findTreasuryPu([], D0)).toBeNull();
        expect(findTreasuryPu(history, null)).toBeNull();
    });
});

describe('markToMarketFixedIncome — razão de PU', () => {
    it('marca pelo PU de venda de hoje sobre o PU de compra do lote', () => {
        const marked = markToMarketFixedIncome(asset(), { history, calcDate });
        // 1000 de custo × (1111 / 1010) = 1100,00
        expect(marked.value).toBeCloseTo(1000 * (1111 / 1010), 6);
        expect(marked.priceDate).toBe(D0);
    });

    it('É INVARIANTE à convenção de quantidade/preço do cadastro', () => {
        // Mesmo custo de R$1.000 escrito de três formas diferentes.
        const comoUmLote = asset({ quantity: 1, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 1, price: 1000 }] });
        const comoFracao = asset({ quantity: 0.32, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 0.32, price: 3125 }] });
        const comoAbsurdo = asset({ quantity: 2, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 2, price: 500 }] });

        const esperado = 1000 * (1111 / 1010);
        for (const posicao of [comoUmLote, comoFracao, comoAbsurdo]) {
            expect(markToMarketFixedIncome(posicao, { history, calcDate }).value).toBeCloseTo(esperado, 6);
        }
    });

    it('soma lotes com âncoras diferentes', () => {
        const doisLotes = asset({
            quantity: 2,
            totalCost: 2000,
            taxLots: [
                { date: dayDate(-4), quantity: 1, price: 1000 },
                { date: dayDate(-2), quantity: 1, price: 1000 },
            ],
        });
        const esperado = 1000 * (1111 / 1010) + 1000 * (1111 / 1060);
        expect(markToMarketFixedIncome(doisLotes, { history, calcDate }).value).toBeCloseTo(esperado, 6);
    });

    it('lote anterior ao início da série derruba a marcação do ativo INTEIRO', () => {
        const comLoteAntigo = asset({
            quantity: 2,
            totalCost: 2000,
            taxLots: [
                { date: new Date('2020-01-02T00:00:00.000Z'), quantity: 1, price: 1000 },
                { date: dayDate(-2), quantity: 1, price: 1000 },
            ],
        });
        expect(markToMarketFixedIncome(comLoteAntigo, { history, calcDate })).toBeNull();
    });

    it('usa o PU de venda como âncora quando o de compra foi descartado', () => {
        const semPuBuy = [{ date: D4, pu: 1000, puBuy: null }, { date: D0, pu: 1111, puBuy: null }];
        expect(markToMarketFixedIncome(asset(), { history: semPuBuy, calcDate }).value)
            .toBeCloseTo(1000 * (1111 / 1000), 6);
    });

    it('compra do dia já nasce com o spread de recompra (é o que o extrato mostra)', () => {
        const compradoHoje = asset({ taxLots: [{ date: dayDate(0), quantity: 1, price: 1000 }] });
        const marked = markToMarketFixedIncome(compradoHoje, { history, calcDate });
        expect(marked.value).toBeCloseTo(1000 * (1111 / 1121), 6);
        expect(marked.value).toBeLessThan(1000);
        // Sem lote anterior ao pregão de referência, não há variação do dia.
        expect(marked.previousValue).toBeNull();
    });

    it('valor de ontem ignora o lote comprado hoje', () => {
        const doisLotes = asset({
            quantity: 2,
            totalCost: 2000,
            taxLots: [
                { date: dayDate(-4), quantity: 1, price: 1000 },
                { date: dayDate(0), quantity: 1, price: 1000 },
            ],
        });
        const marked = markToMarketFixedIncome(doisLotes, { history, calcDate });
        // Ontem só existia o primeiro lote, marcado ao PU do pregão anterior.
        expect(marked.previousValue).toBeCloseTo(1000 * (1080 / 1010), 6);
    });

    it('congela no vencimento: PU posterior não existe e o valor para no par', () => {
        const vencido = asset({ maturityDate: dayDate(-2) });
        const marked = markToMarketFixedIncome(vencido, { history, calcDate });
        expect(marked.priceDate).toBe(D2);
        expect(marked.value).toBeCloseTo(1000 * (1050 / 1010), 6);
    });

    it('caixa/reserva nunca é marcado, mesmo recebendo série (defesa em profundidade)', () => {
        const reserva = {
            type: 'CASH',
            ticker: 'RESERVA-EMERGENCIA',
            quantity: 15000,
            totalCost: 15000,
            taxLots: [{ date: dayDate(-4), quantity: 15000, price: 1 }],
        };
        expect(markToMarketFixedIncome(reserva, { history, calcDate })).toBeNull();
    });

    it('razão implausível é tratada como dado corrompido', () => {
        const corrompida = [{ date: D4, pu: 1000, puBuy: 1000 }, { date: D0, pu: 0.5, puBuy: 0.5 }];
        expect(markToMarketFixedIncome(asset(), { history: corrompida, calcDate })).toBeNull();
    });
});

describe('valueFixedIncomeAsset — porta única', () => {
    it('sem série, devolve o accrual e marca a fonte', () => {
        const out = valueFixedIncomeAsset(asset(), { ...macroRates, calcDate, history: null });
        expect(out.source).toBe(PRICING_SOURCE.ACCRUAL);
        expect(out.market).toBeNull();
        expect(out.value).toBe(out.accrued);
    });

    it('com série, marca a mercado e ainda entrega o valor na curva', () => {
        const out = valueFixedIncomeAsset(asset(), { ...macroRates, calcDate, history });
        expect(out.source).toBe(PRICING_SOURCE.MTM);
        expect(out.value).toBeCloseTo(1000 * (1111 / 1010), 6);
        expect(out.accrued).toBe(accrueFixedIncomeValue(asset(), { ...macroRates, calcDate }));
        expect(out.market).toBe(out.value);
        expect(out.priceDate).toBe(D0);
    });

    it('série inutilizável cai no accrual em vez de zerar a posição', () => {
        const foraDeAlcance = [{ date: '2019-01-02', pu: 1000, puBuy: 1000 }];
        const out = valueFixedIncomeAsset(asset(), { ...macroRates, calcDate, history: foraDeAlcance });
        expect(out.source).toBe(PRICING_SOURCE.ACCRUAL);
        expect(out.value).toBeGreaterThan(0);
    });
});

describe('PU oficial para a UI — preço que não depende da digitação', () => {
    it('devolve o PU de hoje e a fração implícita, e valor = PU × fração', () => {
        const marked = markToMarketFixedIncome(asset(), { history, calcDate });
        expect(marked.unitPrice).toBe(1111);
        expect(marked.units).toBeCloseTo(1000 / 1010, 8);
        // A identidade que justifica exibir os dois: multiplicá-los tem de dar o
        // valor marcado, senão a linha da tela não fecha na cabeça de ninguém.
        expect(marked.unitPrice * marked.units).toBeCloseTo(marked.value, 6);
    });

    it('a fração implícita é a MESMA nas três convenções de cadastro', () => {
        // É esta invariância que faz a carteira cadastrada à mão e a importada da
        // B3 mostrarem o mesmo PU para o mesmo título.
        const comoUmLote = asset({ quantity: 1, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 1, price: 1000 }] });
        const comoFracao = asset({ quantity: 0.32, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 0.32, price: 3125 }] });
        const comoAbsurdo = asset({ quantity: 2, totalCost: 1000, taxLots: [{ date: dayDate(-4), quantity: 2, price: 500 }] });

        for (const posicao of [comoUmLote, comoFracao, comoAbsurdo]) {
            const marked = markToMarketFixedIncome(posicao, { history, calcDate });
            expect(marked.units).toBeCloseTo(1000 / 1010, 8);
            expect(marked.unitPrice).toBe(1111);
        }
    });

    it('soma a fração de lotes ancorados em PUs diferentes', () => {
        const doisLotes = asset({
            quantity: 2,
            totalCost: 2000,
            taxLots: [
                { date: dayDate(-4), quantity: 1, price: 1000 },
                { date: dayDate(-2), quantity: 1, price: 1000 },
            ],
        });
        const marked = markToMarketFixedIncome(doisLotes, { history, calcDate });
        expect(marked.units).toBeCloseTo(1000 / 1010 + 1000 / 1060, 8);
        expect(marked.unitPrice * marked.units).toBeCloseTo(marked.value, 6);
    });

    it('sem série não há preço unitário — a UI omite em vez de inventar', () => {
        const out = valueFixedIncomeAsset(asset(), { ...macroRates, calcDate, history: null });
        expect(out.source).toBe(PRICING_SOURCE.ACCRUAL);
        expect(out.unitPrice).toBeNull();
        expect(out.units).toBeNull();
    });

    it('o card expõe PU de hoje, PU médio de compra e a fração', () => {
        const pricing = { historyFor: () => history, resolve: () => ({ key: 'IPCA|2035-05-15' }), catalog: [], series: new Map() };
        const { processed } = processWalletAsset(asset(), {
            assetMap: new Map(), usdRate: 5, usdChange: 0, macroRates,
            isTodayBusinessDay: true, treasuryPricing: pricing,
        });

        expect(processed.treasuryUnitPrice).toBe(1111);
        expect(processed.treasuryUnits).toBeCloseTo(1000 / 1010, 6);
        // PU médio = custo ÷ fração — reconstrói o PU de compra do lote (1010).
        expect(processed.treasuryAverageUnitPrice).toBeCloseTo(1010, 2);
    });
});

describe('normalizeLots', () => {
    it('CASH usa a quantidade como valor (mesma convenção do accrual)', () => {
        expect(normalizeLots({ type: 'CASH', quantity: 15000, totalCost: 15000, taxLots: [{ date: dayDate(-4), quantity: 15000, price: 1 }] }))
            .toEqual([{ dateIso: D4, cost: 15000 }]);
    });

    it('sem taxLots, sintetiza um lote a partir de startDate e custo total', () => {
        expect(normalizeLots({ type: 'FIXED_INCOME', quantity: 2, totalCost: 500, startDate: dayDate(-2), taxLots: [] }))
            .toEqual([{ dateIso: D2, cost: 500 }]);
    });
});

describe('processWalletAsset — o card usa a MESMA porta de valorização', () => {
    const pricing = (h) => ({ historyFor: () => h, resolve: () => ({ key: 'IPCA|2035-05-15' }), catalog: [], series: new Map() });
    const ctx = (h) => ({
        assetMap: new Map(), usdRate: 5, usdChange: 0, macroRates,
        isTodayBusinessDay: true, treasuryPricing: pricing(h),
    });

    it('totalValue marcado bate com valueFixedIncomeAsset e expõe a fonte', () => {
        const position = asset();
        const { processed } = processWalletAsset(position, ctx(history));
        const esperado = valueFixedIncomeAsset(position, { ...macroRates, calcDate, history });

        expect(processed.pricingSource).toBe(PRICING_SOURCE.MTM);
        expect(processed.totalValue).toBe(safeCurrency(esperado.value));
        // O valor na curva acompanha para a UI mostrar mercado × curva.
        expect(processed.accruedValue).toBeGreaterThan(0);
        expect(processed.accruedValue).not.toBe(processed.totalValue);
    });

    it('sem série, o card segue idêntico ao comportamento na curva', () => {
        const position = asset();
        const { processed } = processWalletAsset(position, ctx(null));
        expect(processed.pricingSource).toBe(PRICING_SOURCE.ACCRUAL);
        expect(processed.totalValue).toBe(safeCurrency(accrueFixedIncomeValue(position, { ...macroRates, calcDate })));
    });

    it('variação do dia vem do PU quando o preço publicado é o de HOJE', () => {
        const { processed } = processWalletAsset(asset(), ctx(history));
        // safeFloat arredonda o percentual exibido a 4 casas.
        expect(processed.dayChangePct).toBeCloseTo(((1111 / 1080) - 1) * 100, 3);
    });

    it('não repete a variação de ontem enquanto o PU de hoje não sai', () => {
        // Série publicada só até ontem: o valor segue marcado no último PU, mas a
        // variação do dia é 0 — o movimento exibido seria o de outro pregão.
        const semHoje = history.slice(0, -1);
        const { processed } = processWalletAsset(asset(), ctx(semHoje));
        expect(processed.pricingSource).toBe(PRICING_SOURCE.MTM);
        expect(processed.dayChangePct).toBe(0);
    });
});

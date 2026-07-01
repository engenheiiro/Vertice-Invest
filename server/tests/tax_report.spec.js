import { describe, it, expect } from 'vitest';
import {
    taxCategory,
    simulatePortfolio,
    settleMonthlyTaxes,
    buildDarfSchedule,
} from '../services/taxReportService.js';

// metaOf de teste: mapeia ticker → tipo/moeda.
const TYPES = {
    PETR4: 'STOCK', VALE3: 'STOCK', ITUB4: 'STOCK', ABEV3: 'STOCK',
    HGLG11: 'FII', KNRI11: 'FII', BOVA11: 'ETF', IVVB11: 'ETF',
    AAPL: 'STOCK_US', BTC: 'CRYPTO',
};
const metaOf = (t) => {
    const type = TYPES[t] || 'STOCK';
    const currency = (type === 'STOCK_US' || type === 'CRYPTO') ? 'USD' : 'BRL';
    return { type, currency, name: t };
};

const tx = (ticker, type, quantity, price, iso) => ({
    ticker, type, quantity, price, date: new Date(`${iso}T12:00:00Z`),
});

// Roda o pipeline puro completo para um conjunto de transações.
const run = (txs, year = 2025) => {
    const { portfolio, buckets, manualGains } = simulatePortfolio(txs, metaOf, year);
    const settled = settleMonthlyTaxes(buckets, year);
    const { darf, carry } = buildDarfSchedule(settled.monthTaxByYm, settled.monthly, year);
    return { portfolio, buckets, manualGains, ...settled, darf, darfCarry: carry };
};

describe('taxCategory', () => {
    it('mapeia tipos para categorias fiscais', () => {
        expect(taxCategory('STOCK', 'BRL')).toBe('ACOES');
        expect(taxCategory('FII', 'BRL')).toBe('FII');
        expect(taxCategory('ETF', 'BRL')).toBe('ETF');
        expect(taxCategory('ETF', 'USD')).toBe('EXTERIOR');
        expect(taxCategory('STOCK_US', 'USD')).toBe('EXTERIOR');
        expect(taxCategory('CRYPTO', 'USD')).toBe('CRIPTO');
        expect(taxCategory('FIXED_INCOME', 'BRL')).toBe(null);
        expect(taxCategory('CASH', 'BRL')).toBe(null);
    });
});

describe('simulatePortfolio — preço médio e posição', () => {
    it('acumula preço médio e mantém posição residual não vendida', () => {
        const { portfolio } = run([
            tx('ABEV3', 'BUY', 100, 10, '2025-01-05'),
            tx('ABEV3', 'BUY', 100, 20, '2025-02-05'), // médio agora 15
        ]);
        expect(portfolio.ABEV3.qty).toBeCloseTo(200, 6);
        expect(portfolio.ABEV3.cost).toBeCloseTo(3000, 2); // 100*10 + 100*20
    });

    it('zera a posição quando totalmente vendida', () => {
        const { portfolio } = run([
            tx('PETR4', 'BUY', 100, 10, '2025-01-05'),
            tx('PETR4', 'SELL', 100, 12, '2025-03-10'),
        ]);
        expect(portfolio.PETR4.qty).toBe(0);
        expect(portfolio.PETR4.cost).toBe(0);
    });
});

describe('settleMonthlyTaxes — Ações', () => {
    it('isenta ganho quando vendas do mês ≤ R$20.000', () => {
        const { monthly, darf } = run([
            tx('PETR4', 'BUY', 100, 10, '2025-01-05'),
            tx('PETR4', 'SELL', 100, 12, '2025-03-10'), // vendas 1200 ≤ 20k, ganho 200
        ]);
        const line = monthly.find(l => l.month === '03' && l.category === 'ACOES');
        expect(line.exempt).toBe(true);
        expect(line.tax).toBe(0);
        expect(darf).toHaveLength(0);
    });

    it('mantém isenção no limite exato de R$20.000', () => {
        const { monthly } = run([
            tx('PETR4', 'BUY', 1000, 15, '2025-01-05'),
            tx('PETR4', 'SELL', 1000, 20, '2025-02-10'), // vendas exatamente 20000
        ]);
        expect(monthly.find(l => l.month === '02').exempt).toBe(true);
    });

    it('tributa 15% quando vendas > R$20.000', () => {
        const { monthly, darf } = run([
            tx('VALE3', 'BUY', 1000, 50, '2025-01-05'),
            tx('VALE3', 'SELL', 1000, 80, '2025-02-10'), // vendas 80000, ganho 30000
        ]);
        const line = monthly.find(l => l.month === '02');
        expect(line.exempt).toBe(false);
        expect(line.taxableBase).toBeCloseTo(30000, 2);
        expect(line.tax).toBeCloseTo(4500, 2); // 30000 * 15%
        expect(darf).toHaveLength(1);
        expect(darf[0].amount).toBeCloseTo(4500, 2);
        expect(darf[0].code).toBe('6015');
    });

    it('compensa prejuízo acumulado antes de tributar', () => {
        const { monthly } = run([
            tx('ITUB4', 'BUY', 1000, 30, '2025-01-02'),
            tx('ITUB4', 'SELL', 1000, 25, '2025-02-05'),  // vendas 25000 (>20k), perda 5000
            tx('ITUB4', 'BUY', 1000, 20, '2025-03-01'),
            tx('ITUB4', 'SELL', 1000, 40, '2025-04-10'),  // vendas 40000, ganho 20000
        ]);
        const feb = monthly.find(l => l.month === '02');
        expect(feb.gain).toBeCloseTo(-5000, 2);
        expect(feb.tax).toBe(0);
        expect(feb.lossCarryAfter).toBeCloseTo(5000, 2);

        const apr = monthly.find(l => l.month === '04');
        expect(apr.compensatedLoss).toBeCloseTo(5000, 2);
        expect(apr.taxableBase).toBeCloseTo(15000, 2); // 20000 - 5000
        expect(apr.tax).toBeCloseTo(2250, 2);          // 15000 * 15%
        expect(apr.lossCarryAfter).toBe(0);
    });

    it('perda em mês de venda isenta NÃO é compensável', () => {
        const { monthly, lossCarryEndOfYear } = run([
            tx('PETR4', 'BUY', 100, 30, '2025-01-02'),
            tx('PETR4', 'SELL', 100, 10, '2025-02-05'), // vendas 1000 ≤ 20k, perda 2000 (isenta)
        ]);
        expect(monthly.find(l => l.month === '02').exempt).toBe(true);
        expect(lossCarryEndOfYear.ACOES).toBe(0); // perda isenta não entra no estoque
    });
});

describe('settleMonthlyTaxes — FIIs', () => {
    it('tributa 20% sem isenção de R$20k', () => {
        const { monthly, darf } = run([
            tx('HGLG11', 'BUY', 100, 100, '2025-01-02'),
            tx('HGLG11', 'SELL', 100, 300, '2025-05-10'), // vendas 30000, ganho 20000
        ]);
        const line = monthly.find(l => l.category === 'FII');
        expect(line.exempt).toBe(false);
        expect(line.tax).toBeCloseTo(4000, 2); // 20000 * 20%
        expect(darf[0].amount).toBeCloseTo(4000, 2);
    });

    it('mantém estoque de prejuízo separado por categoria (FII não compensa Ações)', () => {
        const { lossCarryEndOfYear } = run([
            tx('HGLG11', 'BUY', 100, 300, '2025-01-02'),
            tx('HGLG11', 'SELL', 100, 100, '2025-02-05'), // perda 20000 em FII
        ]);
        expect(lossCarryEndOfYear.FII).toBeCloseTo(20000, 2);
        expect(lossCarryEndOfYear.ACOES).toBe(0);
    });
});

describe('exterior/cripto — conferência manual, fora do DARF', () => {
    it('não entram na apuração mensal nem geram DARF', () => {
        const { monthly, darf, manualGains } = run([
            tx('AAPL', 'BUY', 10, 100, '2025-01-05'),
            tx('AAPL', 'SELL', 10, 150, '2025-06-10'), // exterior, ganho 500
            tx('BTC', 'BUY', 1, 100000, '2025-02-01'),
            tx('BTC', 'SELL', 1, 150000, '2025-07-01'), // cripto, ganho 50000
        ]);
        expect(monthly).toHaveLength(0);
        expect(darf).toHaveLength(0);
        expect(manualGains.get('EXTERIOR').gain).toBeCloseTo(500, 2);
        expect(manualGains.get('CRIPTO').gain).toBeCloseTo(50000, 2);
    });
});

describe('buildDarfSchedule — mínimo de R$10 acumulável', () => {
    it('acumula imposto < R$10 para o mês seguinte', () => {
        const monthTaxByYm = new Map([['2025-01', 6], ['2025-02', 6]]);
        const { darf, carry } = buildDarfSchedule(monthTaxByYm, [], 2025);
        expect(darf).toHaveLength(1);
        expect(darf[0].competencia).toBe('2025-02');
        expect(darf[0].amount).toBeCloseTo(12, 2);
        expect(carry).toBe(0);
    });

    it('deixa sobra < R$10 como carry para o próximo ano', () => {
        const monthTaxByYm = new Map([['2025-11', 5]]);
        const { darf, carry } = buildDarfSchedule(monthTaxByYm, [], 2025);
        expect(darf).toHaveLength(0);
        expect(carry).toBeCloseTo(5, 2);
    });

    it('gera DARF no mês em que o acumulado atinge o mínimo', () => {
        const monthTaxByYm = new Map([['2025-03', 15]]);
        const { darf } = buildDarfSchedule(monthTaxByYm, [], 2025);
        expect(darf).toHaveLength(1);
        expect(darf[0].amount).toBeCloseTo(15, 2);
        // Vencimento: último dia útil de abril/2025 (30/04 é quarta-feira).
        expect(new Date(darf[0].dueDate).getUTCMonth()).toBe(3); // abril
    });

    it('vencimento da competência de dezembro cai em janeiro do ano seguinte', () => {
        const { darf } = buildDarfSchedule(new Map([['2025-12', 500]]), [], 2025);
        expect(darf).toHaveLength(1);
        const due = new Date(darf[0].dueDate);
        expect(due.getUTCMonth()).toBe(0);       // janeiro
        expect(due.getUTCFullYear()).toBe(2026);  // ano seguinte
    });

    it('soma imposto de várias categorias no mesmo mês em um único DARF, com breakdown', () => {
        const { darf } = run([
            tx('VALE3', 'BUY', 1000, 50, '2025-01-05'),
            tx('VALE3', 'SELL', 1000, 80, '2025-02-10'), // Ações: ganho 30000 → 4500
            tx('HGLG11', 'BUY', 100, 100, '2025-01-06'),
            tx('HGLG11', 'SELL', 100, 300, '2025-02-11'), // FII: ganho 20000 → 4000
        ]);
        expect(darf).toHaveLength(1);
        expect(darf[0].competencia).toBe('2025-02');
        expect(darf[0].amount).toBeCloseTo(8500, 2); // 4500 + 4000
        expect(darf[0].breakdown).toHaveLength(2);
        const byCat = Object.fromEntries(darf[0].breakdown.map(b => [b.category, b.tax]));
        expect(byCat.ACOES).toBeCloseTo(4500, 2);
        expect(byCat.FII).toBeCloseTo(4000, 2);
    });
});

describe('settleMonthlyTaxes — FII e ETF não têm isenção de R$20k', () => {
    it('FII com vendas < R$20k é tributado a 20% (sem isenção)', () => {
        const { monthly, darf } = run([
            tx('HGLG11', 'BUY', 100, 100, '2025-01-02'),
            tx('HGLG11', 'SELL', 50, 250, '2025-03-10'), // vendas 12500 (<20k), ganho 7500
        ]);
        const line = monthly.find(l => l.category === 'FII');
        expect(line.exempt).toBe(false);
        expect(line.taxableBase).toBeCloseTo(7500, 2);
        expect(line.tax).toBeCloseTo(1500, 2); // 7500 * 20%
        expect(darf).toHaveLength(1);
    });

    it('ETF nacional com vendas < R$20k é tributado a 15% (sem isenção)', () => {
        const { monthly } = run([
            tx('BOVA11', 'BUY', 100, 100, '2025-01-05'),
            tx('BOVA11', 'SELL', 100, 150, '2025-02-10'), // vendas 15000 (<20k), ganho 5000
        ]);
        const line = monthly.find(l => l.category === 'ETF');
        expect(line.exempt).toBe(false);
        expect(line.taxableBase).toBeCloseTo(5000, 2);
        expect(line.tax).toBeCloseTo(750, 2); // 5000 * 15%
    });
});

describe('settleMonthlyTaxes — netting intra-mês e venda parcial', () => {
    it('compensa ganho e perda da mesma categoria no mesmo mês antes de tributar', () => {
        const { monthly } = run([
            tx('VALE3', 'BUY', 1000, 50, '2025-01-05'),
            tx('VALE3', 'SELL', 500, 80, '2025-02-10'),  // ganho +15000
            tx('VALE3', 'SELL', 500, 40, '2025-02-20'),  // perda -5000
        ]);
        const feb = monthly.find(l => l.month === '02');
        expect(feb.sales).toBeCloseTo(60000, 2);       // 40000 + 20000
        expect(feb.gain).toBeCloseTo(10000, 2);        // 15000 - 5000
        expect(feb.tax).toBeCloseTo(1500, 2);          // 10000 * 15%
    });

    it('venda parcial mantém preço médio na posição residual', () => {
        const { portfolio } = run([
            tx('ABEV3', 'BUY', 100, 10, '2025-01-05'),
            tx('ABEV3', 'BUY', 100, 20, '2025-02-05'),  // médio 15, custo 3000
            tx('ABEV3', 'SELL', 100, 25, '2025-03-10'), // vende 100 ao médio 15
        ]);
        expect(portfolio.ABEV3.qty).toBeCloseTo(100, 6);
        expect(portfolio.ABEV3.cost).toBeCloseTo(1500, 2); // 100 * 15
    });
});

describe('carry entre anos — prejuízo e ganhos informativos', () => {
    it('prejuízo de ano anterior compensa ganho do ano-alvo; linhas antigas ficam fora', () => {
        const { monthly, lossCarryEndOfYear } = run([
            tx('ITUB4', 'BUY', 1000, 30, '2024-01-02'),
            tx('ITUB4', 'SELL', 1000, 25, '2024-06-10'), // 2024: vendas 25000, perda 5000
            tx('ITUB4', 'BUY', 1000, 20, '2025-02-01'),
            tx('ITUB4', 'SELL', 1000, 45, '2025-04-10'), // 2025: ganho 25000
        ], 2025);
        // Nenhuma linha de 2024 deve aparecer.
        expect(monthly.every(l => ['04'].includes(l.month))).toBe(true);
        const apr = monthly.find(l => l.month === '04');
        expect(apr.compensatedLoss).toBeCloseTo(5000, 2);
        expect(apr.taxableBase).toBeCloseTo(20000, 2); // 25000 - 5000
        expect(apr.tax).toBeCloseTo(3000, 2);          // 20000 * 15%
        expect(apr.lossCarryAfter).toBe(0);
        expect(lossCarryEndOfYear.ACOES).toBe(0);
    });

    it('ganho de exterior de ano anterior NÃO entra no manual do ano-alvo', () => {
        const { manualGains } = run([
            tx('AAPL', 'BUY', 10, 100, '2024-01-05'),
            tx('AAPL', 'SELL', 10, 150, '2024-06-10'), // 2024: ganho 500 (fora)
            tx('AAPL', 'BUY', 5, 200, '2025-02-01'),
            tx('AAPL', 'SELL', 5, 250, '2025-07-01'),  // 2025: ganho 250
        ], 2025);
        expect(manualGains.get('EXTERIOR').gain).toBeCloseTo(250, 2);
        expect(manualGains.get('EXTERIOR').sales).toBeCloseTo(1250, 2);
    });
});

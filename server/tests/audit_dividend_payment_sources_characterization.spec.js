import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Caracterização do relatório de scripts/auditDividendPaymentSources.js, gravada
// sobre o script monolítico ANTES da decomposição. Banco e fontes são falsos: o
// script nunca conecta (o .env local aponta para produção) e as fontes devolvem
// casos que passam por todos os desfechos do casamento. O relatório impresso é
// congelado linha a linha.

const d = (s) => new Date(`${s}T00:00:00.000Z`);

const fakes = vi.hoisted(() => ({
    disconnect: vi.fn(),
    connect: vi.fn(async () => {}),
    b3: vi.fn(),
    fundamentus: vi.fn(),
    eventos: [],
    ativos: [],
    agregado: [],
    carteira: [],
}));

const consulta = (rows) => {
    const q = { sort: () => q, select: () => q, lean: async () => rows };
    return q;
};

vi.mock('dotenv', () => ({ default: { config: () => ({}) } }));
vi.mock('mongoose', () => ({ default: { disconnect: fakes.disconnect } }));
vi.mock('../scripts/lib/scriptDb.js', () => ({ connectScriptDb: fakes.connect }));
vi.mock('../services/dividendPaymentDateService.js', () => ({
    FONTES: { B3: { buscar: fakes.b3 }, FUNDAMENTUS: { buscar: fakes.fundamentus } },
}));
vi.mock('../models/DividendEvent.js', () => ({
    default: {
        aggregate: async () => fakes.agregado,
        find: (q) => consulta(q.ticker
            ? fakes.eventos.filter((e) => e.ticker === q.ticker)
            : fakes.eventos.filter((e) => e.paymentDate != null)),
    },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: () => consulta(fakes.ativos) } }));
vi.mock('../models/UserAsset.js', () => ({ default: { distinct: async () => fakes.carteira } }));

const id = (() => { let n = 0; return () => `ev${++n}`; })();
const ev = (ticker, ex, amount, extra = {}) => ({ _id: id(), ticker, date: d(ex), amount, ...extra });
const pag = (dataCom, valor, dataPagamento) => ({ dataCom: d(dataCom), valor, dataPagamento: dataPagamento ? d(dataPagamento) : null });

const FONTE_B3 = {
    GGRC11: [
        pag('2026-09-01', 1.0, '2026-09-09'),
        pag('2026-09-30', 1.0, '2026-10-08'),
        pag('2026-07-31', 0.6, '2026-08-10'),
    ],
    PETR4: [
        pag('2026-08-21', 1.0, '2026-11-23'),
        pag('2026-08-21', 0.5, '2026-12-21'),
        pag('2026-06-12', 3.0, '2026-07-20'),
    ],
    VALE3: [pag('2026-06-30', 1.0, null)],
};
const FONTE_FUNDAMENTUS = {
    GGRC11: [pag('2026-09-01', 1.0, '2026-09-09'), pag('2026-09-30', 1.0, '2026-10-09')],
    VALE3: [],
};

const prepararBase = () => {
    fakes.eventos = [
        ev('GGRC11', '2026-09-02', 1.0),
        ev('GGRC11', '2026-10-01', 1.0, { paymentDate: d('2026-10-08') }),
        ev('GGRC11', '2026-08-03', 0.5, { source: 'DERIVED' }),
        ev('PETR4', '2026-08-24', 1.5),
        ev('PETR4', '2026-06-15', 2.0),
        ev('VALE3', '2026-07-01', 1.0),
        ev('OLD11', '2025-01-10', 1.0, { paymentDate: d('2025-01-25') }),
    ];
    fakes.ativos = [
        { ticker: 'GGRC11', type: 'FII' }, { ticker: 'PETR4', type: 'STOCK' },
        { ticker: 'VALE3', type: 'STOCK' }, { ticker: 'AAPL', type: 'STOCK_US' },
    ];
    fakes.agregado = [{ _id: 'PETR4' }, { _id: 'GGRC11' }, { _id: 'ZZZZ3' }, { _id: 'VALE3' }];
    fakes.carteira = ['vale3'];
    fakes.b3.mockImplementation(async (ticker) => FONTE_B3[ticker] || []);
    fakes.fundamentus.mockImplementation(async (ticker) => {
        if (ticker === 'PETR4') throw new Error('HTTP 403');
        return FONTE_FUNDAMENTUS[ticker] || [];
    });
};

const rodarScript = async (argv) => {
    vi.resetModules();
    const saida = [];
    let terminou;
    const fim = new Promise((r) => { terminou = r; });
    fakes.disconnect.mockImplementation(async () => { terminou(); });
    vi.spyOn(console, 'log').mockImplementation((...a) => { saida.push(a.join(' ')); });
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { saida.push(String(s).replace(/\n$/, '')); return true; });
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
    const argvOriginal = process.argv;
    process.argv = ['node', 'auditDividendPaymentSources.js', ...argv];
    try {
        await import('../scripts/auditDividendPaymentSources.js');
        await fim;
    } finally {
        process.argv = argvOriginal;
        vi.restoreAllMocks();
    }
    return saida;
};

describe('auditDividendPaymentSources — caracterização do relatório', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(d('2026-11-22'));
        prepararBase();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('com tickers explícitos e as duas fontes: todos os desfechos, divergência e falha de acesso', async () => {
        const saida = await rodarScript(['--tickers=GGRC11,PETR4,VALE3,AAPL,NADA11']);
        expect(fakes.connect).toHaveBeenCalled();
        expect(saida).toMatchSnapshot();
    });

    it('com a amostra padrão: carteira primeiro, limite e uma fonte só', async () => {
        const saida = await rodarScript(['--limit=2', '--sources=b3', '--meses=12']);
        expect(saida).toMatchSnapshot();
    });
});

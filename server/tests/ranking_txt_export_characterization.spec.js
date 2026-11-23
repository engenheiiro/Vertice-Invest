/**
 * Caracterização do relatório TXT do ranking (gravada antes de quebrar
 * `formatMetrics`/`formatRankingItem` em partes). Trava o texto byte a byte:
 * cenários gerados por PRNG semeado variando classe, tipo do item, setor
 * (financeiro ou não), métricas ausentes/null/0/NaN/Infinity/negativas,
 * moeda, perfil, ação, tier, teses e audit log vazio ou longo.
 *
 * Só o export público de hoje é importado; o `fs` é falso. Data e hora do
 * cabeçalho dependem do fuso da máquina, então são trocadas por marcadores
 * calculados com as mesmas APIs (o resto do texto não depende do fuso).
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
}));

vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

const { rankingTxtExportService } = await import('../services/rankingTxtExportService.js');

const mulberry32 = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const NUM_POOL = [undefined, null, 0, -0, NaN, Infinity, -Infinity, -5.5, -2e7, 0.4, 1.005, 12.345, 999, 5e3, 2.5e6, 3.3e9, 4e12, 70];
const LOOSE_POOL = [...NUM_POOL, '', '7,5', 'abc'];
const TYPES = ['STOCK', 'FII', 'CRYPTO', 'STOCK_US', 'ETF', undefined];
const SECTORS = [undefined, '', 'Bancos', 'Seguradoras', 'Financeiro', 'Holdings', 'Financial Services', 'Insurance',
    'Petróleo', 'Technology', 'Logística', 'Energia Elétrica'];
const ACTIONS = ['BUY', 'WAIT', 'SELL', undefined];
const TIERS = ['GOLD', 'SILVER', 'BRONZE', 'X', undefined];
const PROFILES = ['DEFENSIVE', 'MODERATE', 'BOLD', 'OUTRO', undefined];
const CATEGORIES = [undefined, 'Qualidade', 'Valuation', 'Risco'];
const ENTRY_TYPES = ['base', 'bonus', 'penalty', undefined];
const CLASSES = ['BRASIL_10', 'STOCK', 'FII', 'CRYPTO', 'STOCK_US'];

const METRIC_KEYS = ['fairPrice', 'grahamPrice', 'bazinPrice', 'marketCap', 'avgLiquidity', 'volatility', 'sma200', 'ema50',
    'pvp', 'evEbitda', 'evEbit', 'psr', 'pEbit', 'pAtivos', 'pCapGiro', 'pAtivCircLiq', 'earningsYield', 'roe', 'roic',
    'netMargin', 'ebitMargin', 'revenueGrowth', 'debtToEquity', 'currentRatio', 'patrimLiq', 'netDebt', 'netRevenue',
    'netIncome', 'totalAssets', 'dy', 'payout', 'vacancy', 'capRate', 'qtdImoveis', 'ffoYield', 'vpCota', 'ffoCota',
    'priceM2', 'rentM2'];
const LOOSE_KEYS = ['pegRatio', 'beta', 'pl'];

const makeGen = (rnd) => {
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const chance = (p) => rnd() < p;
    const metrics = () => {
        if (chance(0.06)) return pick([undefined, null]);
        const m = {};
        for (const k of METRIC_KEYS) if (chance(0.8)) m[k] = pick(NUM_POOL);
        for (const k of LOOSE_KEYS) if (chance(0.8)) m[k] = pick(LOOSE_POOL);
        if (chance(0.6)) m.method = pick([undefined, '', 'Graham', 'Bazin']);
        if (chance(0.6)) m.structural = { quality: pick(LOOSE_POOL), valuation: pick(NUM_POOL), risk: pick(NUM_POOL) };
        if (chance(0.5)) m._staleDays = pick([null, undefined, 0, 12, 400]);
        if (chance(0.5)) {
            m._missing = {};
            const n = Math.floor(rnd() * 4);
            for (let i = 0; i < n; i++) m._missing[pick(['beta', 'roe', 'dy', 'payout', 'pl'])] = chance(0.6);
        }
        return m;
    };
    const auditLog = () => {
        const r = rnd();
        if (r < 0.15) return undefined;
        if (r < 0.3) return [];
        const n = 1 + Math.floor(rnd() * (r > 0.85 ? 25 : 5));
        return Array.from({ length: n }, (_, i) => ({
            category: pick(CATEGORIES),
            factor: chance(0.05) ? undefined : `Fator ${i} ${'x'.repeat(Math.floor(rnd() * 60))}`,
            points: pick([0, -0, 5, -5, 10, -15, 2.5, 100, -100]),
            type: pick(ENTRY_TYPES),
        }));
    };
    const item = (position) => {
        const it = {
            position,
            previousPosition: pick([undefined, null, position, position + 2, Math.max(1, position - 3)]),
            ticker: `TCK${Math.floor(rnd() * 1000)}`,
            name: pick([undefined, '', 'Empresa S.A.']),
            type: pick(TYPES),
            sector: pick(SECTORS),
            action: pick(ACTIONS),
            tier: pick(TIERS),
            riskProfile: pick(PROFILES),
            score: pick(LOOSE_POOL),
            currentPrice: pick([...NUM_POOL, 0.00001234]),
            targetPrice: pick(NUM_POOL),
            isDividendAristocrat: chance(0.2),
            thesis: pick([undefined, '', 'Tese curta']),
            auditLog: auditLog(),
            metrics: metrics(),
        };
        if (chance(0.7)) it.scores = { DEFENSIVE: pick(LOOSE_POOL), MODERATE: pick(NUM_POOL), BOLD: pick(NUM_POOL) };
        if (chance(0.5)) it.bullThesis = chance(0.2) ? [] : ['Alta 1', 'Alta 2'].slice(0, 1 + Math.floor(rnd() * 2));
        if (chance(0.5)) it.bearThesis = chance(0.2) ? [] : ['Baixa 1'];
        return it;
    };
    const data = () => {
        const out = {};
        for (const cls of CLASSES) {
            if (!chance(0.6)) continue;
            const n = Math.floor(rnd() * 4);
            const ranking = Array.from({ length: n }, (_, i) => item(i + 1));
            const fullList = chance(0.5) ? [...ranking.slice(0, 1), item(99)] : undefined;
            const discardLogs = chance(0.4)
                ? [{ assetType: cls, ticker: 'DESC3', reason: 'Liquidez', details: pick([undefined, 'baixa']) }]
                : undefined;
            out[cls] = { ranking, fullList, discardLogs };
        }
        return out;
    };
    const macro = () => (chance(0.3) ? null : {
        selic: pick(NUM_POOL), cdi: pick(NUM_POOL), ipca: pick(NUM_POOL), riskFree: pick(NUM_POOL),
        ntnbLong: pick(NUM_POOL), dollar: pick(NUM_POOL), ibov: pick(NUM_POOL), ibovChange: pick(NUM_POOL),
        btc: pick(NUM_POOL), btcChange: pick(NUM_POOL),
    });
    return { data, macro };
};

const normalizeDate = (txt) => {
    const now = new Date();
    return txt
        .split(now.toLocaleDateString('pt-BR')).join('<DATA>')
        .split(now.toLocaleTimeString('pt-BR')).join('<HORA>');
};

const gerar = async (allData, macro) => {
    fsMock.writeFileSync.mockClear();
    const r = await rankingTxtExportService.saveRankingReport(allData, macro);
    if (!r.success) return `ERRO: ${r.error}`;
    return normalizeDate(fsMock.writeFileSync.mock.calls.at(-1)[1]);
};

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T15:30:00Z'));
    fsMock.existsSync.mockReset().mockReturnValue(true);
});

afterEach(() => {
    vi.useRealTimers();
});

const N_SCENARIOS = 300;

describe('caracterização do TXT do ranking', () => {
    it(`${N_SCENARIOS} cenários semeados, hash por cenário`, async () => {
        const gen = makeGen(mulberry32(20261122));
        const hashes = [];
        let errors = 0;
        for (let i = 0; i < N_SCENARIOS; i++) {
            const txt = await gerar(gen.data(), gen.macro());
            if (txt.startsWith('ERRO:')) errors++;
            hashes.push(`${i}:${hash(txt)}`);
        }
        expect(errors).toBeLessThan(N_SCENARIOS / 3);
        expect(hashes).toMatchSnapshot();
    });

    it('um item de cada tipo, texto completo', async () => {
        const gen = makeGen(mulberry32(7));
        const base = (type, sector, extra = {}) => ({
            position: 1, previousPosition: 2, ticker: `X_${type}`, name: 'Nome', type, sector, action: 'BUY',
            tier: 'GOLD', riskProfile: 'DEFENSIVE', score: 81.25, currentPrice: 12.5, targetPrice: 15,
            scores: { DEFENSIVE: 81.25, MODERATE: 60, BOLD: 40 },
            auditLog: [{ category: 'Qualidade', factor: 'ROE', points: 10, type: 'bonus' }],
            metrics: {
                fairPrice: 14, grahamPrice: 13, bazinPrice: 0, pegRatio: -1, marketCap: 2e9, avgLiquidity: 3e6,
                volatility: 25, beta: 1.1, sma200: 11, ema50: 12, pl: 9, pvp: 0, evEbitda: 0, roic: 0, roe: 15,
                netMargin: 10, ebitMargin: 12, dy: 6, vacancy: 4, structural: { quality: 70, valuation: 60, risk: 50 },
                _staleDays: 3, _missing: { roic: true },
            },
            ...extra,
        });
        const casos = {
            STOCK: { ranking: [base('STOCK', 'Bancos'), base('STOCK', 'Energia', { position: 2, action: 'WAIT' })] },
            FII: { ranking: [base('FII', 'Logística', { riskProfile: 'MODERATE' })] },
            CRYPTO: { ranking: [base('CRYPTO', undefined, { riskProfile: 'BOLD', currentPrice: 0.00001 })] },
            STOCK_US: { ranking: [base('STOCK_US', 'Insurance'), base('STOCK_US', 'Technology', { position: 2 })] },
            BRASIL_10: { ranking: [base('ETF', 'Índice', { metrics: null, auditLog: [] })] },
        };
        const txt = await gerar(casos, gen.macro());
        expect(txt).toMatchSnapshot();
    });

    it('cenários aleatórios completos para diff legível', async () => {
        const gen = makeGen(mulberry32(99));
        const out = [];
        for (let i = 0; i < 3; i++) out.push(await gerar(gen.data(), gen.macro()));
        expect(out).toMatchSnapshot();
    });
});

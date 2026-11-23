// Caracterização de treasuryPriceService: congela parseTreasuryPriceCsv,
// describeTesouroDownloadProblem, parseTesouroDiretoQuotes e ingestTreasuryPrices
// sobre cenários de PRNG semeado. O CSV cobre BOM, `;`, decimais com vírgula e
// milhar com ponto, datas inválidas, famílias com cupom, linhas sem colunas,
// PU 0/negativo, compra corrompida e Data Base repetida. A ingestão roda com
// download, TreasuryPriceHistory, Sentry e logger falsos e o relógio fixo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mulberry32, canon, hash16 } from './helpers/characterization.js';

const axiosGet = vi.fn();
vi.mock('axios', () => ({ default: { get: (...args) => axiosGet(...args) } }));

const aggregate = vi.fn();
const bulkWrite = vi.fn();
vi.mock('../models/TreasuryPriceHistory.js', () => ({
    default: { aggregate: (...a) => aggregate(...a), bulkWrite: (...a) => bulkWrite(...a) },
}));

const sentryCalls = [];
vi.mock('@sentry/node', () => ({ captureMessage: (...a) => sentryCalls.push(a) }));

const logCalls = [];
vi.mock('../config/logger.js', () => ({
    default: {
        info: (...a) => logCalls.push(['info', ...a]),
        warn: (...a) => logCalls.push(['warn', ...a]),
        error: (...a) => logCalls.push(['error', ...a]),
        debug: () => {},
    },
}));

const {
    parseTreasuryPriceCsv,
    describeTesouroDownloadProblem,
    parseTesouroDiretoQuotes,
    ingestTreasuryPrices,
    clearCsvMemo,
    _clearTesouroDiretoMemo,
    TESOURO_CSV_URL,
} = await import('../services/treasuryPriceService.js');

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// ─── CSV ────────────────────────────────────────────────────────────────────

const HEADER_COLS = [
    'Tipo Titulo', 'Data Vencimento', 'Data Base', 'Taxa Compra Manha',
    'Taxa Venda Manha', 'PU Compra Manha', 'PU Venda Manha', 'PU Base Manha',
];
const LABELS = [
    'Tesouro Prefixado', 'Tesouro Prefixado com Juros Semestrais', 'Tesouro IPCA+',
    'Tesouro IPCA+ com Juros Semestrais', 'Tesouro IGPM+ com Juros Semestrais', 'Tesouro Selic',
    'Tesouro Educa+', 'Tesouro Renda+ Aposentadoria Extra', ' Tesouro IPCA+ ', 'LTN', '', 'Tesouro IGPM+',
];
const MATURITIES = ['01/01/2029', '15/05/2035', '15/08/2050', '01/03/2027', '2035-05-15', '', '31/02/2030'];
const BASES = [
    '01/10/2026', '02/10/2026', '05/10/2026', '06/10/2026', '30/09/2026', '15/03/2019', '02/01/2018',
    '2026-10-01', '', '1/10/2026', '32/13/2026', ' 07/10/2026 ',
];

const fmtBr = (v, thousands) => {
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    const intPart = thousands ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : int;
    return `${v < 0 ? '-' : ''}${intPart},${dec}`;
};

const genPu = (rnd) => {
    const r = rnd();
    if (r < 0.06) return '0';
    if (r < 0.1) return '0,00';
    if (r < 0.14) return '-12,30';
    if (r < 0.18) return '';
    if (r < 0.21) return 'abc';
    if (r < 0.24) return '1234.56';
    const v = 500 + rnd() * 4000;
    return { v, s: fmtBr(v, rnd() < 0.6) };
};

const puText = (x) => (typeof x === 'string' ? x : x.s);
const puVal = (x) => (typeof x === 'string' ? 1000 : x.v);

const genBuy = (rnd, sell) => {
    const r = rnd();
    if (r < 0.1) return '';
    if (r < 0.15) return '0';
    if (r < 0.25) return fmtBr(puVal(sell) * 0.97, false); // compra abaixo da venda
    if (r < 0.35) return fmtBr(puVal(sell) * 1.2, true); // spread absurdo
    if (r < 0.4) return fmtBr(puVal(sell) * 1.08, false); // no limite
    return fmtBr(puVal(sell) * (1 + rnd() * 0.05), rnd() < 0.5);
};

const genRate = (rnd) => pick(rnd, ['6,45', '12,88', '0,10', '-0,05', '', 'n/d', '7.5', '10']);

const genHeader = (rnd) => {
    let cols = [...HEADER_COLS];
    if (rnd() < 0.5) cols = cols.sort(() => rnd() - 0.5);
    if (rnd() < 0.12) cols = cols.filter((c) => c !== pick(rnd, HEADER_COLS));
    if (rnd() < 0.05) cols = cols.filter((c) => c !== 'PU Venda Manha' && c !== 'PU Base Manha');
    if (rnd() < 0.15) cols = cols.map((c) => (rnd() < 0.3 ? ` ${c.toUpperCase()} ` : c));
    return cols;
};

const genRow = (rnd, cols) => {
    const sell = genPu(rnd);
    const values = {
        'tipo titulo': pick(rnd, LABELS),
        'data vencimento': pick(rnd, MATURITIES),
        'data base': pick(rnd, BASES),
        'taxa compra manha': genRate(rnd),
        'taxa venda manha': genRate(rnd),
        'pu compra manha': genBuy(rnd, sell),
        'pu venda manha': puText(sell),
        'pu base manha': puText(rnd() < 0.5 ? genPu(rnd) : sell),
    };
    let cells = cols.map((c) => values[c.trim().toLowerCase()] ?? '');
    if (rnd() < 0.08) cells = cells.slice(0, Math.floor(rnd() * cells.length));
    return cells.join(';');
};

const genCsv = (seed) => {
    const rnd = mulberry32(seed);
    if (rnd() < 0.03) return pick(rnd, [null, undefined, 42, '', 'Tipo Titulo;Data Base']);
    const cols = genHeader(rnd);
    const lines = [cols.join(';')];
    const n = Math.floor(rnd() * 30);
    for (let i = 0; i < n; i++) {
        if (rnd() < 0.05) lines.push('');
        else if (rnd() < 0.1 && lines.length > 1) lines.push(lines[1 + Math.floor(rnd() * (lines.length - 1))]);
        else lines.push(genRow(rnd, cols));
    }
    const eol = rnd() < 0.5 ? '\r\n' : '\n';
    const bom = rnd() < 0.3 ? '\uFEFF' : '';
    return bom + lines.join(eol) + (rnd() < 0.3 ? eol : '');
};

const SINCE = [undefined, null, '2026-10-02', '2020-01-01', '2026-12-31'];
const parseScenario = (seed) => {
    const rnd = mulberry32(seed * 7919);
    const since = pick(rnd, SINCE);
    const csv = genCsv(seed);
    return since === undefined ? parseTreasuryPriceCsv(csv) : parseTreasuryPriceCsv(csv, { sinceIso: since });
};

describe('parseTreasuryPriceCsv — caracterização', () => {
    it('hash por cenário (400 CSVs semeados)', () => {
        const hashes = {};
        for (let seed = 1; seed <= 400; seed += 1) hashes[seed] = hash16(parseScenario(seed));
        expect(hashes).toMatchSnapshot();
    });

    it('cenários completos legíveis', () => {
        expect([5, 17, 23, 61].map((s) => canon(parseScenario(s)))).toMatchSnapshot();
    });

    it('casos fixos: BOM, cupom, duplicata e PU inválido', () => {
        const header = '\uFEFFTipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha';
        const csv = [
            header,
            'Tesouro IPCA+ com Juros Semestrais;15/08/2050;02/10/2026;6,1;6,2;4.120,10;4.098,50;4.098,00',
            'Tesouro IPCA+ com Juros Semestrais;15/08/2050;01/10/2026;6,1;6,2;3.963,80;4.098,00;4.097,00',
            'Tesouro IPCA+ com Juros Semestrais;15/08/2050;02/10/2026;6,1;6,3;4.121,10;4.099,50;4.099,00',
            'Tesouro Selic;01/03/2029;02/10/2026;0,1;0,11;0;0;17.000,00',
            'Tesouro Selic;01/03/2029;03/10/2026;0,1;0,11;;-5;-1',
            'Tesouro Prefixado;01/01/2029;02/10/2026',
            'Tesouro Prefixado;01/01/2029;xx/10/2026;1;1;1;1;1',
        ].join('\r\n');
        expect(canon(parseTreasuryPriceCsv(csv))).toMatchSnapshot();
    });
});

// ─── Diagnóstico do download ────────────────────────────────────────────────

const STATUSES = [undefined, null, 200, 204, 199, 301, 403, 404, 410, 429, 500, 503, 302];
const CONTENT_TYPES = [undefined, '', 'text/csv', 'text/html; charset=utf-8', 'TEXT/HTML', 'application/json', null];
const BODIES = [
    undefined, null, '', 'abc', 'x'.repeat(999), 'x'.repeat(1000), 12345,
    '<!DOCTYPE html><html><head><title>429 - Muitas Requisições</title></head><body>Acesso Limitado</body></html>',
    '  <html><head><title>Just a moment...</title></head><body>cf-chl</body></html>',
    '<head><title>\n  Manutenção   programada \n</title></head>',
    '<body>sem título</body>',
    `<html>${'y'.repeat(5000)}too many requests</html>`,
    `Tipo Titulo;Data Vencimento;Data Base\n${'a;b;c\n'.repeat(300)}`,
    `<p>${'z'.repeat(1200)}</p>`,
];
const ERRORS = [
    undefined, null, { code: 'ECONNABORTED', message: 'timeout' }, { name: 'AbortError' }, { code: 'ERR_CANCELED' },
    { name: 'TimeoutError', message: 'x' }, { code: 'ECONNRESET', message: 'socket hang up' },
    { message: 'm'.repeat(300) }, 'string error', new Error('etimedout'), { code: 'ETIMEDOUT' },
];

const genProblemInput = (seed) => {
    const rnd = mulberry32(seed);
    if (rnd() < 0.03) return undefined;
    const input = {};
    if (rnd() < 0.85) input.status = pick(rnd, STATUSES);
    if (rnd() < 0.8) input.contentType = pick(rnd, CONTENT_TYPES);
    if (rnd() < 0.9) input.body = pick(rnd, BODIES);
    if (rnd() < 0.25) input.error = pick(rnd, ERRORS);
    return input;
};

describe('describeTesouroDownloadProblem — caracterização', () => {
    it('saída por cenário (300 entradas semeadas)', () => {
        const out = {};
        for (let seed = 1; seed <= 300; seed += 1) out[seed] = canon(describeTesouroDownloadProblem(genProblemInput(seed)));
        expect(hash16(out)).toMatchSnapshot();
        expect(Object.values(out).filter((_, i) => i % 15 === 0)).toMatchSnapshot();
    });

    it('sem argumento', () => {
        expect(describeTesouroDownloadProblem()).toMatchSnapshot();
    });
});

// ─── JSON do Tesouro Direto ─────────────────────────────────────────────────

const TD_NAMES = [
    'Tesouro IPCA+ 2040', 'Tesouro IPCA+ com Juros Semestrais 2055', 'Tesouro Prefixado 2031', 'Tesouro Selic 2029',
    'Tesouro Educa+ 2045', 'Tesouro Renda+ Aposentadoria Extra 2065', 'CDB Banco X', '', null, undefined,
];
const TD_MATURITIES = ['2040-08-15T00:00', '2031-01-01', '2029-03-01T00:00:00', '15/08/2040', '', null, undefined, 20400815];
const TD_DATES = [
    '2026-10-23T18:00:08.193', '2026-10-24T09:00:00', '2026-10-26', '2026-11-02T10:00', '2026-11-20T10:00',
    'ontem', '', null, undefined,
];
const TD_VALUES = [1971.53, '1971.53', 0, -3, null, undefined, 'x', 4098.5, 17000.12];
const TD_RATES = ['IPCA + 6,65%', '12,88%', 'SELIC + 0,1089%', 'SELIC', '', null, '-0,5 %', 'IPCA + 6,1% a 7,2%'];

const genTdBond = (rnd) => {
    if (rnd() < 0.04) return pick(rnd, [null, undefined]);
    const b = {};
    if (rnd() < 0.95) b.treasuryBondName = pick(rnd, TD_NAMES);
    if (rnd() < 0.93) b.maturityDate = pick(rnd, TD_MATURITIES);
    if (rnd() < 0.93) b.lastMarketPricingDate = pick(rnd, TD_DATES);
    if (rnd() < 0.93) b.unitaryRedemptionValue = pick(rnd, TD_VALUES);
    const r = rnd();
    if (r < 0.2) b.unitaryInvestmentValue = pick(rnd, TD_VALUES);
    else if (r < 0.9 && typeof b.unitaryRedemptionValue === 'number') {
        b.unitaryInvestmentValue = b.unitaryRedemptionValue * pick(rnd, [1, 1.01, 1.075, 1.08, 1.085, 1.09, 0.99, 1.5]);
    }
    if (rnd() < 0.9) b.redemptionProfitabilityFeeIndexerName = pick(rnd, TD_RATES);
    return b;
};

const genTdJson = (seed) => {
    const rnd = mulberry32(seed);
    if (rnd() < 0.04) return pick(rnd, [null, undefined, {}, { TesouroLegado: [] }]);
    const json = {};
    if (rnd() < 0.85) json.TesouroLegado = Array.from({ length: Math.floor(rnd() * 8) }, () => genTdBond(rnd));
    if (rnd() < 0.6) json.Tesouro24x7 = Array.from({ length: Math.floor(rnd() * 5) }, () => genTdBond(rnd));
    if (rnd() < 0.1) json.TesouroLegado = null;
    if (rnd() < 0.3 && json.TesouroLegado?.length) {
        // Duplicata do mesmo título (mesma família + vencimento): o primeiro vence.
        const copy = { ...json.TesouroLegado[0], unitaryRedemptionValue: 1234.5 };
        (json.Tesouro24x7 ||= []).push(copy);
    }
    return json;
};

const BUSINESS_DAY_FNS = [
    undefined,
    () => true,
    (d) => !d.endsWith('4'),
];
const tdScenario = (seed) => {
    const rnd = mulberry32(seed * 104729);
    const fn = pick(rnd, BUSINESS_DAY_FNS);
    const json = genTdJson(seed);
    return fn === undefined ? parseTesouroDiretoQuotes(json) : parseTesouroDiretoQuotes(json, { isBusinessDay: fn });
};

describe('parseTesouroDiretoQuotes — caracterização', () => {
    it('hash por cenário (300 JSONs semeados)', () => {
        const hashes = {};
        for (let seed = 1; seed <= 300; seed += 1) hashes[seed] = hash16(tdScenario(seed));
        expect(hashes).toMatchSnapshot();
    });

    it('cenários completos legíveis', () => {
        expect([2, 9, 33, 77].map((s) => canon(tdScenario(s)))).toMatchSnapshot();
    });

    it('sem argumento', () => {
        expect(canon(parseTesouroDiretoQuotes())).toMatchSnapshot();
    });
});

// ─── Ingestão ───────────────────────────────────────────────────────────────

const CSV_HEADER = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha';
const INGEST_LABELS = [
    ['Tesouro IPCA+', '15/08/2040'], ['Tesouro Selic', '01/03/2029'], ['Tesouro Prefixado', '01/01/2031'],
    ['Tesouro IPCA+ com Juros Semestrais', '15/08/2055'],
];
const BASE_DAYS = [
    '2018-01-02', '2019-06-03', '2026-10-15', '2026-10-16', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26',
];
const isoToBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const genIngestCsv = (rnd) => {
    const top = pick(rnd, [2, 4, 5, 6, 7, 7]);
    const rows = [CSV_HEADER];
    for (let i = 0; i < 40; i++) {
        const [label, mat] = pick(rnd, INGEST_LABELS);
        const day = BASE_DAYS[Math.floor(rnd() * (top + 1))];
        let pu = 1000 + Math.floor(rnd() * 3000);
        if (rnd() < 0.1) pu = Math.round(pu * 1.5);
        rows.push(`${label};${mat};${isoToBr(day)};6,1;6,2;${fmtBr(pu * 1.01, true)};${fmtBr(pu, true)};${fmtBr(pu, false)}`);
    }
    return rows.join('\n');
};

const csvResponse = (rnd) => {
    const kind = pick(rnd, ['neterr', 'timeout', '429', 'html', 'short', 'nolayout', 'csv', 'csv', 'csv', 'csv']);
    switch (kind) {
        case 'neterr': return { reject: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) };
        case 'timeout': return { reject: Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }) };
        case '429': return { status: 429, headers: { 'content-type': 'text/plain' }, data: 'slow down' };
        case 'html': return { status: 200, headers: { 'content-type': 'text/html' }, data: '<html><title>Acesso Limitado</title></html>' };
        case 'short': return { status: 200, headers: {}, data: 'a;b' };
        case 'nolayout': return { status: 200, headers: { 'content-type': 'text/csv' }, data: `x;y;z\n${'1;2;3\n'.repeat(400)}` };
        default: return { status: 200, headers: { 'content-type': 'text/csv' }, data: genIngestCsv(rnd) };
    }
};

const TD_INGEST_NAMES = [
    'Tesouro IPCA+ 2040', 'Tesouro Selic 2029', 'Tesouro Prefixado 2031', 'Tesouro IPCA+ com Juros Semestrais 2055', 'Tesouro Educa+ 2045',
];
const TD_INGEST_MATS = {
    'Tesouro IPCA+ 2040': '2040-08-15', 'Tesouro Selic 2029': '2029-03-01', 'Tesouro Prefixado 2031': '2031-01-01',
    'Tesouro IPCA+ com Juros Semestrais 2055': '2055-08-15', 'Tesouro Educa+ 2045': '2045-12-15',
};

const tdResponse = (rnd) => {
    const kind = pick(rnd, ['neterr', '500', 'string', 'empty', 'quotes', 'quotes', 'quotes']);
    if (kind === 'neterr') return { reject: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) };
    if (kind === '500') return { status: 500, headers: { 'content-type': 'text/html' }, data: '<html>erro</html>' };
    if (kind === 'string') return { status: 200, headers: { 'content-type': 'text/plain' }, data: 'not json' };
    if (kind === 'empty') return { status: 200, headers: {}, data: { TesouroLegado: [] } };
    const date = pick(rnd, ['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27']);
    const bonds = TD_INGEST_NAMES.filter(() => rnd() < 0.8).map((name) => ({
        treasuryBondName: name,
        maturityDate: `${TD_INGEST_MATS[name]}T00:00`,
        lastMarketPricingDate: `${date}T18:00:00`,
        unitaryRedemptionValue: 1000 + Math.floor(rnd() * 3000),
        unitaryInvestmentValue: 1000 + Math.floor(rnd() * 3200),
        redemptionProfitabilityFeeIndexerName: pick(rnd, ['IPCA + 6,65%', 'SELIC + 0,1%', '13,1%']),
    }));
    return { status: 200, headers: { 'content-type': 'application/json' }, data: { TesouroLegado: bonds } };
};

const NOWS = ['2026-10-27T15:00:00.000Z', '2026-10-26T02:30:00.000Z', '2026-10-24T13:00:00.000Z', '2026-11-03T12:00:00.000Z'];
const TODAYS = [undefined, '2026-10-26', '2026-10-27', '2026-10-25', '2026-10-28', '2026-11-03'];

const runIngest = async (seed) => {
    const rnd = mulberry32(seed);
    vi.setSystemTime(new Date(pick(rnd, NOWS)));
    clearCsvMemo();
    _clearTesouroDiretoMemo();
    axiosGet.mockReset();
    aggregate.mockReset();
    bulkWrite.mockReset();
    sentryCalls.length = 0;
    logCalls.length = 0;

    const csvRes = csvResponse(rnd);
    const tdRes = tdResponse(rnd);
    const urls = [];
    axiosGet.mockImplementation(async (url) => {
        urls.push(url === TESOURO_CSV_URL ? 'CSV' : 'TD');
        const res = url === TESOURO_CSV_URL ? csvRes : tdRes;
        if (res.reject) throw res.reject;
        return res;
    });
    const stored = ['IPCA|2040-08-15', 'SELIC|2029-03-01', 'PRE|2031-01-01', 'IPCA_JS|2055-08-15'];
    const aggRows = stored.filter(() => rnd() < 0.7).map((titleKey) => ({
        titleKey, last: pick(rnd, [null, '2026-10-15', '2026-10-22', '2026-10-23', '2026-10-26']),
    }));
    aggregate.mockResolvedValue(aggRows);
    bulkWrite.mockResolvedValue({});

    const opts = {};
    const today = pick(rnd, TODAYS);
    if (today !== undefined) opts.todayKey = today;
    if (rnd() < 0.3) opts.years = pick(rnd, [1, 8, 10]);
    if (rnd() < 0.3) opts.force = true;
    const result = await ingestTreasuryPrices(opts);
    const second = rnd() < 0.15 ? await ingestTreasuryPrices({ ...opts, force: false }) : null;

    return {
        result,
        second,
        urls,
        aggregate: aggregate.mock.calls,
        bulkWrite: bulkWrite.mock.calls,
        sentry: sentryCalls,
        logs: logCalls,
    };
};

describe('ingestTreasuryPrices — caracterização', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(() => vi.useRealTimers());

    it('hash por cenário (200 ingestões semeadas)', async () => {
        const hashes = {};
        for (let seed = 1; seed <= 200; seed += 1) hashes[seed] = hash16(await runIngest(seed));
        expect(hashes).toMatchSnapshot();
    });

    it('cenários completos legíveis (resultado e chamadas)', async () => {
        const out = [];
        for (const seed of [3, 8, 14, 21]) {
            const r = await runIngest(seed);
            out.push(canon({ result: r.result, second: r.second, urls: r.urls, sentry: r.sentry, writes: r.bulkWrite.length }));
        }
        expect(out).toMatchSnapshot();
    });
});

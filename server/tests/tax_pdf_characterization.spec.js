import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Caracterização do PDF de IR (`buildTaxPdf`, exercitado pelo handler
// `getTaxReportPdf`): o snapshot foi gravado no código ANTERIOR à divisão da
// função em partes. Não comparamos bytes do PDF (embutem data de criação): o
// pdf-lib é trocado por um documento falso que registra, em ordem, cada página
// aberta e cada desenho (texto, retângulo, linha) com posição, tamanho, fonte e
// cor. As larguras de texto são as REAIS das fontes padrão (truncamento e
// alinhamento à direita dependem delas). Nada toca o banco.

const log = vi.hoisted(() => ({ ops: [] }));

vi.mock('pdf-lib', async (importOriginal) => {
  const real = await importOriginal();
  const fontDoc = await real.PDFDocument.create();
  const fonts = new Map();
  const fontFor = async (name) => {
    if (!fonts.has(name)) {
      const f = await fontDoc.embedFont(name);
      fonts.set(name, { name, widthOfTextAtSize: (t, s) => f.widthOfTextAtSize(t, s) });
    }
    return fonts.get(name);
  };
  const plain = (opts) => ({ ...opts, ...(opts.font ? { font: opts.font.name } : {}) });
  const PDFDocument = {
    create: async () => {
      let pages = 0;
      return {
        embedFont: fontFor,
        addPage: (size) => {
          pages += 1;
          const n = pages;
          log.ops.push(['page', n, size]);
          return {
            drawText: (text, opts) => log.ops.push(['text', n, text, plain(opts)]),
            drawRectangle: (opts) => log.ops.push(['rect', n, plain(opts)]),
            drawLine: (opts) => log.ops.push(['line', n, plain(opts)]),
          };
        },
        save: async () => new Uint8Array([37, 80, 68, 70]),
      };
    },
  };
  return { ...real, PDFDocument };
});

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/taxReportService.js', () => ({ taxReportService: { computeReport: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));

const { taxReportService } = await import('../services/taxReportService.js');
const User = (await import('../models/User.js')).default;
const { getTaxReportPdf } = await import('../controllers/taxController.js');

const AGORA = new Date('2026-11-18T17:00:00.000Z');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AGORA); });
afterEach(() => { vi.useRealTimers(); });

const SCENARIOS = 250;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TICKERS = ['PETR4', 'VALE3', 'HGLG11', 'IVVB11', 'AAPL', 'BTC', 'ΩXYZ🚀', 'TESOURO IPCA+ 2035 COM NOME BEM COMPRIDO DEMAIS PARA A COLUNA'];
const NAMES = ['Petrobras PN', 'CSHG Logística', 'Fundo ≤ Teste 你好', '',
  'Nome muito longo de um fundo imobiliário que não cabe na coluna reservada ao nome'];
const CATEGORIES = ['ACOES', 'FII', 'ETF', 'EXTERIOR', 'CRIPTO', 'OUTRA'];
const MONTHS = ['01', '02', '03', '06', '09', '12', '13', 'xx'];
const USERS = [null, {}, { name: 'Investidor Teste' }, { email: 'so@email.com' },
  { name: 'Usuário 你好 ≤ → × com nome extremamente comprido que estoura o bloco do cabeçalho', email: 'x@x.com' }];
const LONG = 'Isenção de vendas ≤ R$20.000/mês → atenção às regras × exceções; '
  + 'este aviso é longo o bastante para quebrar em várias linhas no parágrafo do PDF.';

function buildScenario(seed) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const chance = (p) => r() < p;
  const money = () => (chance(0.1) ? 0 : Math.round((r() * 2 - 0.3) * 1e6) / 100);
  const count = (max) => (chance(0.25) ? 0 : 1 + Math.floor(r() * max));
  const big = chance(0.15);

  const positionsByGroup = Array.from({ length: count(3) }, () => ({
    grupo: pick(['03', '07', '08']),
    groupLabel: pick(['Ações (mercado à vista)', 'FIIs', 'Bens no Exterior (Ações/ETF/REIT)']),
    totalCost: money(),
    items: Array.from({ length: big ? 20 + Math.floor(r() * 40) : count(6) }, () => ({
      ticker: pick(TICKERS),
      quantity: chance(0.3) ? Math.round(r() * 1e8) / 1e6 : Math.floor(r() * 5000),
      avgPrice: money(),
      totalCost: money(),
      manualReview: chance(0.3),
    })),
  }));
  const monthly = Array.from({ length: big ? 30 + Math.floor(r() * 30) : count(10) }, () => ({
    month: pick(MONTHS),
    category: pick(CATEGORIES),
    sales: money(),
    gain: money(),
    exempt: chance(0.3),
    taxableBase: money(),
    tax: chance(0.4) ? 0 : money(),
  }));
  const darf = Array.from({ length: count(4) }, () => ({
    month: pick(MONTHS), code: pick(['6015', '6015-01']),
    dueDate: new Date(Date.UTC(2025, Math.floor(r() * 12), 1 + Math.floor(r() * 28))), amount: money(),
  }));
  const byTicker = Array.from({ length: big ? 40 + Math.floor(r() * 40) : count(8) }, () => ({
    ticker: pick(TICKERS), name: pick(NAMES), amount: money(),
  }));
  return {
    user: pick(USERS),
    report: {
      year: 2025,
      generatedAt: new Date(Date.UTC(2026, Math.floor(r() * 11), 1 + Math.floor(r() * 27), 12)),
      summary: {
        totalDarf: money(), totalDividends: money(), totalPositionCostBRL: money(),
        positionsCount: Math.floor(r() * 50),
      },
      positionsByGroup,
      monthly,
      darf,
      darfCarryToNextYear: chance(0.4) ? Math.round(r() * 999) / 100 : 0,
      lossCarryEndOfYear: { ACOES: chance(0.3) ? money() : 0, FII: chance(0.3) ? money() : 0, ETF: chance(0.3) ? money() : 0 },
      dividends: { total: money(), byTicker },
      manualReviewItems: Array.from({ length: count(3) }, () => ({
        category: pick(CATEGORIES), sales: money(), realizedGain: money(),
      })),
      disclaimers: Array.from({ length: count(6) }, (_, i) => (chance(0.5) ? LONG : `Aviso ${i}`)),
    },
  };
}

const EMPTY = {
  user: null,
  report: {
    year: 2024, generatedAt: new Date('2025-03-01T12:00:00Z'),
    summary: { totalDarf: 0, totalDividends: 0, totalPositionCostBRL: 0, positionsCount: 0 },
    positionsByGroup: [], monthly: [], darf: [], darfCarryToNextYear: 0,
    lossCarryEndOfYear: { ACOES: 0, FII: 0, ETF: 0 }, dividends: { total: 0, byTicker: [] },
    manualReviewItems: [], disclaimers: [],
  },
};

// Serialização estável: chaves ordenadas, número não-finito e -0 explícitos.
function stable(value) {
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '"-0"';
    if (!Number.isFinite(value)) return `"${String(value)}"`;
    return JSON.stringify(value);
  }
  if (value === undefined) return '"undefined"';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function render({ report, user }) {
  log.ops = [];
  taxReportService.computeReport.mockResolvedValue(report);
  User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(user) }) });
  const res = { headers: {}, sent: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.send = (b) => { res.sent = b; return res; };
  let error = null;
  await getTaxReportPdf({ params: { year: String(report.year) }, user: { id: 'u1' } }, res, (e) => { error = e; });
  return {
    error: error ? `${error.constructor.name}: ${error.message}` : null,
    headers: res.headers,
    sentLength: res.sent ? res.sent.length : null,
    ops: log.ops,
  };
}

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('getTaxReportPdf — caracterização do desenho (snapshot gravado no código anterior à divisão)', () => {
  it('desenha exatamente as mesmas coisas em todos os cenários', async () => {
    const out = [];
    for (let seed = 1; seed <= SCENARIOS; seed++) out.push(`${seed}:${digest(stable(await render(buildScenario(seed))))}`);
    expect(out).toMatchSnapshot();
  });

  it('a matriz exercita os ramos que importam', async () => {
    const outs = [];
    for (let seed = 1; seed <= SCENARIOS; seed++) outs.push(await render(buildScenario(seed)));
    const texts = (o) => o.ops.filter((op) => op[0] === 'text').map((op) => op[2]);
    const has = (needle) => outs.filter((o) => texts(o).some((t) => t.includes(needle))).length;
    const pages = outs.map((o) => o.ops.filter((op) => op[0] === 'page').length);
    expect(outs.filter((o) => o.error).length).toBe(0);
    expect(pages.filter((n) => n >= 3).length).toBeGreaterThan(10);
    expect(has('isento')).toBeGreaterThan(20);
    expect(has('Nenhum DARF devido')).toBeGreaterThan(10);
    expect(has('Competência')).toBeGreaterThan(20);
    expect(has('Prejuízo a compensar')).toBeGreaterThan(10);
    expect(has('ficou abaixo de R$10,00')).toBeGreaterThan(10);
    expect(has('Conferência Manual')).toBeGreaterThan(20);
    expect(has('Nenhuma posição em aberto')).toBeGreaterThan(10);
    expect(has('Nenhuma venda de renda variável')).toBeGreaterThan(10);
    expect(has('Nenhum provento recebido')).toBeGreaterThan(10);
    expect(has('(conferir câmbio)')).toBeGreaterThan(20);
    expect(has('…')).toBeGreaterThan(20);
    expect(has('?')).toBeGreaterThan(20);
  });

  it('cenários legíveis de referência (diff por campo quando algo muda)', async () => {
    const readable = [];
    for (const sc of [EMPTY, buildScenario(3), buildScenario(11)]) readable.push(JSON.parse(stable(await render(sc))));
    expect(readable).toMatchSnapshot();
  });
});

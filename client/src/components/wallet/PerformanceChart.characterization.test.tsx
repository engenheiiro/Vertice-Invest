/**
 * Caracterização do PerformanceChart: centenas de cenários semeados (tema,
 * demo, privacidade, KPIs, histórico vazio/curto/com nulos/fora de ordem,
 * resposta quebrada, erro, carregando, relógio em pontos de corte) seguidos de
 * cliques de período, %/R$ e Ibovespa. O HTML após cada passo vira um sha256
 * travado — a quebra do componente em partes não pode mudar um caractere.
 * O recharts é trocado por dublês que despejam tudo o que recebem e aplicam os
 * formatadores a valores de amostra.
 */
import React from 'react';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PerformanceChart } from './PerformanceChart';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';

const { themeState } = vi.hoisted(() => ({ themeState: { theme: 'light' } }));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => themeState }));
vi.mock('../../data/DEMO_DATA', () => ({
  DEMO_PERFORMANCE: [
    { date: '2026-05-01', wallet: 0, walletRoi: 0, cdi: 0.8, ibov: -1.5, ipca: 0.6, equity: 322.34 },
    { date: '2026-06-01', wallet: 5.5, walletRoi: 2.5, cdi: 1.6, ibov: -3.2, ipca: 1.3, equity: 340.07 },
    { date: '2026-07-01', wallet: 12.2, walletRoi: 7.1, cdi: 2.5, ibov: -2.1, ipca: 2.0, equity: 361.67 },
    { date: '2026-08-01', wallet: 22.5, walletRoi: 11.3, cdi: 3.4, ibov: 0.5, ipca: 2.8, equity: 394.87 },
    { date: '2026-09-01', wallet: 35.4, walletRoi: 18.0, cdi: 4.3, ibov: 40, ipca: 3.6, equity: 436.45 },
    { date: '2026-10-01', wallet: 31.1, walletRoi: 16.3, cdi: 5.2, ibov: 2.4, ipca: 4.4, equity: 422.59 },
  ],
}));

/** Serialização estável: distingue undefined, NaN, ±Infinity e -0. */
function ser(v: unknown): string {
  if (v === undefined) return 'U';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') return 'F';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(ser).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${k}:${ser(o[k])}`).join(',')}}`;
}

type Fmt = (v: unknown, n?: string) => unknown;
const safe = (f: () => unknown) => { try { return ser(f()); } catch (e) { return `ERR:${(e as Error).message}`; } };

vi.mock('recharts', async () => {
  const R = await import('react');
  const el = R.createElement;
  type P = Record<string, unknown> & { children?: React.ReactNode };
  return {
    ResponsiveContainer: ({ children, ...p }: P) => el('div', { 'data-rc': ser(p) }, children),
    AreaChart: ({ children, ...p }: P) => el('div', { 'data-chart': ser(p) }, children),
    Area: (p: P) => el('span', { 'data-area': ser(p) }),
    CartesianGrid: (p: P) => el('i', { 'data-grid': ser(p) }),
    XAxis: (p: P) => {
      const f = p.tickFormatter as Fmt;
      const ticks = (p.ticks as string[] | undefined) ?? [];
      const out = [...ticks, 'lixo', '2026-02-30', '2026-11-10T12:00:00Z'].map((t) => safe(() => f(t)));
      return el('div', { 'data-x': ser(p), 'data-xf': out.join('|') });
    },
    YAxis: (p: P) => {
      const f = p.tickFormatter as Fmt;
      const out = [12000, -3456.7, 0, 0.4999, 87.5].map((v) => safe(() => f(v)));
      return el('div', { 'data-y': ser(p), 'data-yf': out.join('|') });
    },
    Tooltip: (p: P) => {
      const f = p.formatter as Fmt;
      const lf = p.labelFormatter as Fmt;
      const names = ['walletBRL', 'walletVal', 'cdi', 'cdiBRL', 'ipca', 'ipcaBRL', 'ibov', 'ibovBRL', 'outro'];
      const out = names.map((n, i) => safe(() => f(1234.5 - i * 777.25, n)));
      const labels = ['2026-11-10', '2026-01-01', '2025-12-31'].map((l) => safe(() => lf(l)));
      return el('div', { 'data-tt': ser(p), 'data-ttf': out.join('|'), 'data-ttl': labels.join('|') });
    },
  };
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const num = (r: Rng, lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
const maybe = (r: Rng, v: number) => {
  const x = r();
  if (x < 0.06) return null;
  if (x < 0.1) return undefined;
  if (x < 0.13) return 0;
  return v;
};

const pad = (n: number) => String(n).padStart(2, '0');
function randomDate(r: Rng): string {
  const y = pick(r, [2024, 2025, 2025, 2026, 2026, 2026]);
  const m = 1 + Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  const kind = r();
  if (kind < 0.04) return `${y}-${pad(m)}-${pad(d)}T12:00:00Z`;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function randomPoint(r: Rng): Record<string, unknown> {
  const p: Record<string, unknown> = {
    date: randomDate(r),
    wallet: maybe(r, num(r, -30, 80)),
    walletRoi: maybe(r, num(r, -30, 80)),
    cdi: maybe(r, num(r, 0, 30)),
    ibov: maybe(r, num(r, -20, 50)),
    ipca: maybe(r, num(r, 0, 25)),
    equity: maybe(r, num(r, 0, 90000)),
    cdiValue: maybe(r, num(r, 0, 90000)),
    ipcaValue: maybe(r, num(r, 0, 90000)),
    ibovValue: maybe(r, num(r, 0, 90000)),
  };
  for (const k of Object.keys(p)) if (k !== 'date' && r() < 0.05) delete p[k];
  const tie = r();
  // Empates e valores pequenos exercitam as fronteiras do selo "Superando o Mercado".
  if (tie < 0.12) { p.cdi = p.wallet; p.cdiValue = p.equity; }
  else if (tie < 0.22) { p.wallet = num(r, 0.1, 0.9); p.cdi = 0.05; p.ibov = pick(r, [0, null, undefined, 0.05]); }
  else if (tie < 0.3) { p.ibov = p.wallet; p.ibovValue = p.equity; p.cdi = -50; p.cdiValue = 0; }
  return p;
}

const NOWS = [
  new Date(2026, 10, 15, 12), new Date(2026, 10, 1, 8), new Date(2026, 0, 1, 0, 30),
  new Date(2026, 2, 31, 23), new Date(2025, 11, 31, 18),
];

type Resp = 'ok' | 'histNull' | 'nullResp' | 'semHist' | 'naoArray' | 'erro' | 'pendente';
const RESPS: Resp[] = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'histNull', 'nullResp', 'semHist', 'naoArray', 'erro', 'pendente'];

function randomKpis(r: Rng): unknown {
  return pick(r, [
    null, undefined, { totalEquity: 0 }, { totalEquity: -5 },
    { totalEquity: 15000, weightedRentability: 11.5, totalResultPercent: 20 },
    { totalEquity: 999, weightedRentability: -3.2, totalResultPercent: 'x' },
    { totalEquity: 50000, weightedRentability: 99, totalResultPercent: -12.75 },
    { totalEquity: 1, weightedRentability: undefined },
  ]);
}

const ACTIONS = ['Mês', 'YTD', '12M', 'Tudo', '%', 'R$', 'ibov'] as const;
type Action = typeof ACTIONS[number];

function click(a: Action) {
  const btn = a === 'ibov'
    ? screen.queryByRole('button', { name: /Ibovespa$/ })
    : screen.queryByRole('button', { name: a });
  if (btn) fireEvent.click(btn);
  return !!btn;
}

const digest = (html: string) => createHash('sha256').update(html).digest('hex').slice(0, 16);

const getPerformance = vi.fn();
const flush = async (demo: boolean) => {
  await act(async () => {
    if (demo) vi.advanceTimersByTime(700);
    await Promise.resolve();
    await Promise.resolve();
  });
};

interface Scenario {
  theme: string; demo: boolean; privacy: boolean; ready: boolean; kpis: unknown;
  resp: Resp; history: Array<Record<string, unknown>>; now: Date; actions: Action[];
}

function buildScenario(seed: number): Scenario {
  const r = mulberry32(seed);
  const size = pick(r, [0, 1, 2, 2, 3, 5, 8, 12, 25]);
  return {
    theme: pick(r, ['light', 'dark']),
    demo: r() < 0.15,
    privacy: r() < 0.35,
    ready: r() > 0.05,
    kpis: randomKpis(r),
    resp: pick(r, RESPS),
    history: Array.from({ length: size }, () => randomPoint(r)),
    now: pick(r, NOWS),
    actions: Array.from({ length: Math.floor(r() * 7) }, () => pick(r, ACTIONS)),
  };
}

function respond(s: Scenario) {
  const map: Record<Resp, () => Promise<unknown>> = {
    ok: async () => ({ history: s.history.map((p) => ({ ...p })) }),
    histNull: async () => ({ history: null }),
    nullResp: async () => null,
    semHist: async () => ({}),
    naoArray: async () => ({ history: { length: 2 } }),
    erro: async () => { throw new Error('offline'); },
    pendente: () => new Promise(() => {}),
  };
  getPerformance.mockImplementation(map[s.resp]);
}

function mountScenario(s: Scenario) {
  vi.useFakeTimers({ toFake: s.demo ? ['Date', 'setTimeout'] : ['Date'] });
  vi.setSystemTime(s.now);
  themeState.theme = s.theme;
  vi.mocked(useDemo).mockReturnValue({ isDemoMode: s.demo } as unknown as ReturnType<typeof useDemo>);
  vi.mocked(useWallet).mockReturnValue({
    kpis: s.kpis, activeWalletId: 'w1', isWalletScopeReady: s.ready, isPrivacyMode: s.privacy, dataSource: { getPerformance },
  } as unknown as ReturnType<typeof useWallet>);
  respond(s);
  return render(<PerformanceChart />);
}

async function runScenario(s: Scenario): Promise<string[]> {
  const { container, unmount } = mountScenario(s);
  const steps = [`inicio:${digest(container.innerHTML)}`];
  await flush(s.demo);
  steps.push(`carregado:${digest(container.innerHTML)}`);
  for (const a of s.actions) {
    const hit = click(a);
    steps.push(`${a}${hit ? '' : '(ausente)'}:${digest(container.innerHTML)}`);
  }
  unmount();
  vi.useRealTimers();
  return steps;
}

const N = 320;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('caracterização do PerformanceChart', () => {
  it(`HTML de ${N} cenários semeados × cliques`, async () => {
    const rows: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const s = buildScenario(seed);
      const steps = await runScenario(s);
      rows.push(`#${seed} ${s.theme}${s.demo ? ' demo' : ''}${s.privacy ? ' priv' : ''} ${s.resp} n=${s.history.length} :: ${steps.join(' ')}`);
    }
    expect(rows).toMatchSnapshot();
  }, 60_000);

  it('HTML completo de cenários escolhidos (diff legível)', async () => {
    const chosen: Scenario[] = [
      { ...buildScenario(7), theme: 'dark', demo: false, privacy: true, ready: true, resp: 'ok',
        kpis: { totalEquity: 15000, weightedRentability: 11.5, totalResultPercent: 20 },
        history: [
          { date: '2026-11-10', wallet: 9, walletRoi: 9, cdi: 4, ibov: 1, ipca: 2, equity: 10000, cdiValue: 9000, ipcaValue: 9500, ibovValue: 8000 },
          { date: '2025-06-01', wallet: 1, walletRoi: 1, cdi: 1, ibov: null, ipca: 2 },
          { date: '2026-10-20', wallet: 7, walletRoi: 7, cdi: 3, ibov: 1, ipca: 2, equity: 9000 },
        ],
        now: NOWS[0], actions: ['R$', 'ibov', 'Mês'] },
      { ...buildScenario(9), theme: 'light', demo: false, privacy: false, ready: true, resp: 'ok', kpis: null,
        history: [
          { date: '2026-09-01', wallet: 1, walletRoi: 1, cdi: 1, ibov: 1, ipca: 1, equity: 500, cdiValue: 400, ipcaValue: 450, ibovValue: 500 },
          { date: '2026-10-01', wallet: 2, walletRoi: 2, cdi: 1, ibov: 2, ipca: 1, equity: 700, cdiValue: 600, ipcaValue: 650, ibovValue: 700 },
        ],
        now: NOWS[0], actions: ['R$', 'ibov'] },
      { ...buildScenario(8), theme: 'light', demo: true, privacy: false, ready: true, resp: 'ok',
        kpis: null, history: [], now: NOWS[1], actions: ['ibov', 'YTD'] },
    ];
    const out: string[] = [];
    for (const s of chosen) {
      const { container, unmount } = mountScenario(s);
      await flush(s.demo);
      for (const a of s.actions) click(a);
      out.push(container.innerHTML);
      unmount();
      vi.useRealTimers();
    }
    expect(out).toMatchSnapshot();
  }, 60_000);
});

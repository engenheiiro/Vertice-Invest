/**
 * Caracterização de `applyWeeklyRetention` e `applyBrasil10Retention`
 * (utils/weeklyRetention.js), gravada ANTES da quebra das duas funções em passos.
 *
 * Gera cenários com PRNG semeado (mulberry32): rankings anteriores ausentes, em
 * Map ou em array; incumbentes que ficam, saem do universo, perdem o portão,
 * caem abaixo do mínimo; empates de score; scores na borda de 62/70; balde de
 * setor e de gestora de FII; teto de retenções; campos ausentes. A saída é
 * serializada com chaves ordenadas e guardada como hash por cenário, mais
 * alguns cenários por extenso para o diff ser legível.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { applyWeeklyRetention, applyBrasil10Retention } from '../utils/weeklyRetention.js';

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const canon = (value) => {
  if (value === undefined) return '__undef';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '__NaN';
    if (!Number.isFinite(value)) return value > 0 ? '__Inf' : '__-Inf';
    if (Object.is(value, -0)) return '__-0';
    return value;
  }
  if (value instanceof Map) return { __map: [...value.entries()].map(([k, v]) => [k, canon(v)]) };
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
};

const serialize = value => JSON.stringify(canon(value));
const hash = value => createHash('sha256').update(serialize(value)).digest('hex').slice(0, 16);

const STOCKS = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'WEGE3', 'ABEV3', 'COGN3', 'CSED3', 'PSSA3', 'ABCB4', 'TAEE11', 'EGIE3'];
const FIIS = ['KNCR11', 'KNRI11', 'KNIP11', 'HGLG11', 'HGRU11', 'HGBS11', 'XPML11', 'BTLG11', 'ZZAB11', 'ZZCD11', 'MXRF11', 'VISC11'];
const STOCK_SECTORS = ['Bancos', 'Energia Elétrica', 'Petróleo e Gás', 'Varejo', 'Mineração', undefined, 'Setor Inventado'];
const FII_SECTORS = ['Logística', 'Lajes Corporativas', 'Papel', 'Shoppings', undefined, 'Híbrido'];
const PROFILES = ['DEFENSIVE', 'MODERATE', 'BOLD'];
const EDGE_SCORES = [61, 62, 63, 69, 70, 71, 61.5, 69.99, 70, 62];

const makeTools = (rand) => {
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = list => list[Math.floor(rand() * list.length)];
  const chance = p => rand() < p;
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const score = () => {
    const r = rand();
    if (r < 0.4) return pick(EDGE_SCORES);
    if (r < 0.5) return pick([75, 75, 80]); // empates frequentes
    return int(20, 95);
  };
  const oddScore = () => pick([undefined, null, NaN, 'abc', '71', Infinity]);
  const spellTicker = (ticker) => {
    if (chance(0.08)) return ticker.toLowerCase();
    if (chance(0.06)) return `${ticker}.SA`;
    return ticker;
  };
  return { int, pick, chance, shuffle, score, oddScore, spellTicker };
};

const structural = (t) => {
  if (t.chance(0.15)) return undefined;
  if (t.chance(0.1)) return { quality: 60 };
  return { quality: t.pick([50, 60, 70]), valuation: t.pick([40, 60]), risk: t.pick([55, 60, 65]) };
};

const isFiiTicker = ticker => /11$/.test(ticker) && !ticker.startsWith('TAEE');

const makeSeat = (t, ticker, profile) => {
  const fii = isFiiTicker(ticker);
  const score = t.score();
  return {
    ticker: t.spellTicker(ticker),
    name: t.chance(0.1) ? undefined : `Nome ${ticker}`,
    type: fii ? 'FII' : 'STOCK',
    sector: t.pick(fii ? FII_SECTORS : STOCK_SECTORS),
    score,
    riskProfile: profile,
    action: score >= 70 ? 'BUY' : 'WAIT',
    tier: 'GOLD',
    metrics: { structural: structural(t) },
  };
};

const makeAsset = (t, ticker) => {
  const fii = isFiiTicker(ticker);
  const scores = {};
  for (const profile of PROFILES) {
    if (t.chance(0.1)) continue;
    scores[profile] = t.chance(0.08) ? t.oddScore() : t.score();
  }
  const asset = {
    ticker: t.spellTicker(ticker),
    type: fii ? 'FII' : 'STOCK',
    sector: t.pick(fii ? FII_SECTORS : STOCK_SECTORS),
    metrics: { structural: structural(t) },
  };
  if (!t.chance(0.1)) asset.scores = scores;
  if (!t.chance(0.15)) asset.name = `Ativo ${ticker}`;
  const eligibility = t.int(0, 4);
  if (eligibility === 0) asset.isDefensiveEligible = false;
  else if (eligibility === 1) asset.isDefensiveEligible = true;
  if (t.chance(0.5)) asset.auditLog = [{ factor: 'Base', points: 1 }];
  return asset;
};

const makePrevious = (t, incumbents, missing) => {
  const shape = t.int(0, 9);
  if (shape === 0) return t.pick([null, undefined]);
  const items = t.shuffle([...incumbents, ...missing]).map((ticker, idx) => {
    const item = { ticker: t.spellTicker(ticker) };
    if (!t.chance(0.1)) item.position = idx + 1;
    item.score = t.chance(0.1) ? t.oddScore() : t.score();
    if (!t.chance(0.15)) item.riskProfile = t.pick([...PROFILES, 'DEFENSIVE']);
    if (!t.chance(0.2)) item.name = `Prev ${ticker}`;
    if (t.chance(0.5)) item.action = 'BUY';
    return item;
  });
  if (t.chance(0.1)) items.push({ ticker: '' }, { ticker: null });
  if (shape === 1) return [];
  if (shape === 2) {
    // Map pronto (formato de loadPublishedRankingBaseline): chave normalizada.
    const map = new Map();
    for (const item of items) {
      const key = String(item.ticker || '').toUpperCase().replace('.SA', '').replace(/[^A-Z0-9]/g, '');
      if (key) map.set(key, { ...item, ticker: key });
    }
    return map;
  }
  return items;
};

const makeConfig = (t) => {
  if (t.chance(0.5)) return undefined;
  return {
    holdScore: t.pick([62, 62, 70, 0, 50]),
    maxRetentionShare: t.pick([0.3, 0.3, 0.5, 1, 0, 0.1]),
    sectorCap: t.pick([3, 1, 2, 10]),
  };
};

const makeWeeklyOptions = (t) => {
  const options = {};
  const config = makeConfig(t);
  if (config) options.config = config;
  if (t.chance(0.2)) options.profiles = t.pick([['DEFENSIVE'], ['MODERATE', 'BOLD'], ['BOLD', 'DEFENSIVE', 'MODERATE']]);
  if (t.chance(0.25)) options.sectorCap = t.pick([1, 2, 4, NaN]);
  if (t.chance(0.25)) options.sectorCapByProfile = { DEFENSIVE: t.pick([4, 1, '2', undefined]) };
  if (t.chance(0.3)) options.applyConcentrationPenalty = t.pick([false, true, 0]);
  if (t.chance(0.15)) options.relaxSectorConcentration = t.pick([true, 1, false]);
  return options;
};

const pickPool = (t) => {
  const mode = t.int(0, 2);
  if (mode === 0) return STOCKS;
  if (mode === 1) return FIIS;
  return [...STOCKS, ...FIIS];
};

const SAME_MANAGER = ['KNCR11', 'KNRI11', 'KNIP11', 'KNCA11', 'KNHY11', 'HGLG11', 'HGRU11', 'HGBS11', 'HGCR11'];

const weeklyScenario = (seed, { managerFocus = false } = {}) => {
  const t = makeTools(mulberry32(seed));
  const pool = t.shuffle(managerFocus ? SAME_MANAGER : pickPool(t));
  const seatCount = t.chance(0.05) ? 0 : t.int(1, Math.min(12, pool.length - 2));
  const listed = pool.slice(0, seatCount);
  const absent = pool.slice(seatCount);
  const extraProfile = t.chance(0.1) ? 'SPECULATIVE' : null;
  const seatProfile = () => {
    if (managerFocus) return t.chance(0.8) ? 'DEFENSIVE' : 'MODERATE';
    return extraProfile && t.chance(0.2) ? extraProfile : t.pick(PROFILES);
  };
  const current = listed.map(ticker => makeSeat(t, ticker, seatProfile()));
  const incumbents = listed.filter(() => t.chance(0.5));
  const missing = absent.slice(0, t.int(0, Math.min(8, absent.length)));
  const previous = makePrevious(t, incumbents, missing);
  const universeTickers = [...listed, ...missing.filter(() => t.chance(0.8)), ...absent.slice(missing.length).filter(() => t.chance(0.3))];
  const processedAssets = universeTickers.map(ticker => makeAsset(t, ticker));
  if (t.chance(0.1) && processedAssets.length) processedAssets.push({ ...processedAssets[0], scores: { DEFENSIVE: 99 } });
  if (t.chance(0.05)) processedAssets.push(null, { ticker: '' });
  const params = { current, previous, processedAssets, options: makeWeeklyOptions(t) };
  if (t.chance(0.03)) delete params.options;
  return params;
};

const brasil10Scenario = (seed) => {
  const t = makeTools(mulberry32(seed));
  const halfCount = t.pick([2, 2, 2, 1, 0, 3]);
  const pools = [t.shuffle(STOCKS), t.shuffle(FIIS), t.shuffle([...STOCKS, ...FIIS])];
  const allMissing = [];
  const allIncumbents = [];
  const halves = [];
  for (let h = 0; h < halfCount; h += 1) {
    const pool = pools[h];
    const size = t.chance(0.05) ? 0 : t.int(1, 6);
    const listed = pool.slice(0, size);
    const absent = pool.slice(size);
    const missing = absent.slice(0, t.int(0, 4));
    allIncumbents.push(...listed.filter(() => t.chance(0.5)));
    allMissing.push(...missing);
    const half = {
      selected: listed.map(ticker => makeSeat(t, ticker, 'DEFENSIVE')),
      universe: [...listed, ...missing.filter(() => t.chance(0.8))].map(ticker => makeAsset(t, ticker)),
    };
    if (t.chance(0.05)) delete half.selected;
    if (t.chance(0.05)) delete half.universe;
    if (t.chance(0.1)) half.label = `metade-${h}`;
    halves.push(half);
  }
  if (t.chance(0.1)) allMissing.push('GONE3');
  const previous = makePrevious(t, allIncumbents, allMissing);
  const options = {};
  const config = makeConfig(t);
  if (config) options.config = config;
  const params = { halves, previous, options };
  if (t.chance(0.03)) delete params.options;
  return params;
};

const SCENARIOS = 600;
const FULL_JSON = [3, 17, 42, 101];

describe('caracterização — applyWeeklyRetention', () => {
  it('hash por cenário', () => {
    const hashes = {};
    for (let seed = 1; seed <= SCENARIOS; seed += 1) {
      hashes[seed] = hash(applyWeeklyRetention(weeklyScenario(seed)));
    }
    expect(hashes).toMatchSnapshot();
  });

  it('hash por cenário — FIIs concentrados em poucas gestoras', () => {
    const hashes = {};
    for (let seed = 1; seed <= 200; seed += 1) {
      hashes[seed] = hash(applyWeeklyRetention(weeklyScenario(seed, { managerFocus: true })));
    }
    expect(hashes).toMatchSnapshot();
  });

  it('cenários por extenso', () => {
    for (const seed of FULL_JSON) {
      expect(canon(applyWeeklyRetention(weeklyScenario(seed)))).toMatchSnapshot(`seed ${seed}`);
    }
  });

  it('sem argumento e sem baseline devolve a lista como está', () => {
    expect(canon(applyWeeklyRetention())).toMatchSnapshot();
  });

  it('a matriz exercita todos os desfechos', () => {
    const outcomes = new Set();
    let retainedCount = 0;
    let bootstraps = 0;
    for (let seed = 1; seed <= SCENARIOS; seed += 1) {
      const out = applyWeeklyRetention(weeklyScenario(seed));
      out.exits.forEach(exit => outcomes.add(exit.outcome));
      retainedCount += out.retained.length;
      if (out.bootstrap) bootstraps += 1;
    }
    expect([...outcomes].sort()).toEqual([
      'BELOW_HOLD', 'BUDGET_EXHAUSTED', 'INELIGIBLE', 'LEFT_UNIVERSE',
      'NO_DISPLACEABLE_SEAT', 'SECTOR_CAP', 'WOULD_DROP_BUY',
    ]);
    expect(retainedCount).toBeGreaterThan(20);
    expect(bootstraps).toBeGreaterThan(5);
  });
});

describe('caracterização — applyBrasil10Retention', () => {
  it('hash por cenário', () => {
    const hashes = {};
    for (let seed = 1; seed <= SCENARIOS; seed += 1) {
      hashes[seed] = hash(applyBrasil10Retention(brasil10Scenario(seed)));
    }
    expect(hashes).toMatchSnapshot();
  });

  it('cenários por extenso', () => {
    for (const seed of FULL_JSON) {
      expect(canon(applyBrasil10Retention(brasil10Scenario(seed)))).toMatchSnapshot(`seed ${seed}`);
    }
  });

  it('sem argumento e sem baseline devolve as metades como estão', () => {
    expect(canon(applyBrasil10Retention())).toMatchSnapshot();
  });

  it('a matriz exercita todos os desfechos', () => {
    const outcomes = new Set();
    let retainedCount = 0;
    for (let seed = 1; seed <= SCENARIOS; seed += 1) {
      const out = applyBrasil10Retention(brasil10Scenario(seed));
      out.exits.forEach(exit => outcomes.add(exit.outcome));
      retainedCount += out.retained.length;
    }
    expect([...outcomes].sort()).toEqual([
      'BELOW_HOLD', 'BUDGET_EXHAUSTED', 'INELIGIBLE', 'LEFT_UNIVERSE',
      'NO_DISPLACEABLE_SEAT', 'WOULD_DROP_BUY',
    ]);
    expect(retainedCount).toBeGreaterThan(20);
  });
});

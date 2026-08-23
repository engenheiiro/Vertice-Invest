/**
 * Retenção de assento — o PLUG no pipeline (aiResearchService).
 *
 * O que este arquivo protege é a promessa do `shadow: true`: a retenção é
 * calculada e auditada, mas a lista publicada continua sendo exatamente a do
 * draft. Se um dia alguém virar a flag sem querer, é aqui que quebra.
 *
 * As dependências pesadas do módulo (Gemini, models, services) são mockadas só
 * para o import não tocar rede/DB — o mesmo padrão de research_delta.spec.js.
 * `weeklyRetention` e `weeklyHysteresis` ficam REAIS: são o objeto do teste.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/DiscardLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/engines/scoringEngine.js', () => ({ scoringEngine: {} }));
vi.mock('../services/engines/portfolioEngine.js', () => ({ portfolioEngine: {} }));
vi.mock('../services/rankingTxtExportService.js', () => ({ rankingTxtExportService: {} }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { buildBrasil10, getTop5Defensive } = await import('../services/aiResearchService.js');
const { WEEKLY_HYSTERESIS } = await import('../config/weeklyHysteresis.js');

const mk = (ticker, type, def, extra = {}) => ({
  ticker,
  name: ticker,
  type,
  sector: type === 'FII' ? 'Logística' : 'Bancos',
  scores: { DEFENSIVE: def, MODERATE: def - 5, BOLD: def - 10 },
  isDefensiveEligible: true,
  metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
  ...extra,
});

const stocks = [92, 88, 84, 80, 76, 72].map((d, i) => mk(`S${i}3`, 'STOCK', d));
const fiis = [95, 90, 85, 80, 75].map((d, i) => mk(`F${i}11`, 'FII', d));

/** Publicação anterior em que S53 (o 6º, hoje fora do top-5) tinha assento. */
const previousWithIncumbent = () => {
  const list = [...getTop5Defensive(stocks).slice(0, 4), mk('S53', 'STOCK', 76), ...getTop5Defensive(fiis)];
  return list.map((item, idx) => ({
    ticker: item.ticker,
    name: item.ticker,
    score: item.scores?.DEFENSIVE ?? item.score,
    action: 'BUY',
    riskProfile: 'DEFENSIVE',
    position: idx + 1,
  }));
};

describe('buildBrasil10 — compatibilidade', () => {
  it('sem `previous`, a assinatura de dois argumentos segue idêntica', () => {
    const list = buildBrasil10(stocks, fiis);
    expect(list).toHaveLength(10);
    expect(list.filter(a => a.type === 'STOCK')).toHaveLength(5);
    expect(list.filter(a => a.type === 'FII')).toHaveLength(5);
    expect(list.every(a => a.riskProfile === 'DEFENSIVE')).toBe(true);
    expect(list.every(a => a.action === (a.score >= 70 ? 'BUY' : 'WAIT'))).toBe(true);
  });

  it('sem `previous`, nenhuma auditoria de retenção é emitida', () => {
    const sink = vi.fn();
    buildBrasil10(stocks, fiis, { onRetentionAudit: sink });
    expect(sink).not.toHaveBeenCalled();
  });

  it('`previous: null` (primeira apuração) audita bootstrap sem reter ninguém', () => {
    let audit = null;
    const list = buildBrasil10(stocks, fiis, { previous: null, onRetentionAudit: a => { audit = a; } });
    expect(audit.bootstrap).toBe(true);
    expect(audit.retained).toEqual([]);
    expect(list.map(i => i.ticker)).toEqual(buildBrasil10(stocks, fiis).map(i => i.ticker));
  });
});

describe('retenção agindo — o incumbente entra na lista publicada', () => {
  it('o incumbente ausente do top-5 volta, deslocando o menor não-incumbente', () => {
    expect(WEEKLY_HYSTERESIS.shadow).toBe(false); // a premissa do teste
    const semRetencao = buildBrasil10(stocks, fiis).map(i => i.ticker);
    const comRetencao = buildBrasil10(stocks, fiis, { previous: previousWithIncumbent() }).map(i => i.ticker);

    expect(semRetencao).not.toContain('S53');
    expect(comRetencao).toContain('S53');
    expect(comRetencao).not.toContain('S43'); // o menor não-incumbente saiu
    expect(comRetencao).toHaveLength(10);
  });

  it('a lista continua 5 + 5, com posições contíguas e action derivada do score', () => {
    const list = buildBrasil10(stocks, fiis, { previous: previousWithIncumbent() });
    expect(list.filter(i => i.type === 'STOCK')).toHaveLength(5);
    expect(list.filter(i => i.type === 'FII')).toHaveLength(5);
    expect(list.map(i => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(list.every(i => i.action === (i.score >= 70 ? 'BUY' : 'WAIT'))).toBe(true);
    expect(list.every(i => i.riskProfile === 'DEFENSIVE')).toBe(true);
  });

  it('o item retido carrega o rastro da retenção, sem inventar action', () => {
    const kept = buildBrasil10(stocks, fiis, { previous: previousWithIncumbent() })
      .find(i => i.ticker === 'S53');
    expect(kept.retention).toMatchObject({
      retained: true,
      holdScore: WEEKLY_HYSTERESIS.holdScore,
      previousScore: 76,
    });
    expect(kept.retention.displaced.ticker).toBe('S43');
    expect(kept.action).toBe(kept.score >= 70 ? 'BUY' : 'WAIT');
  });

  it('a auditoria registra o que foi aplicado', () => {
    let audit = null;
    buildBrasil10(stocks, fiis, {
      previous: previousWithIncumbent(),
      onRetentionAudit: a => { audit = a; },
    });
    expect(audit).toMatchObject({
      version: 'WEEKLY_RETENTION_V1',
      assetClass: 'BRASIL_10',
      shadow: false,
      applied: true,
      holdScore: WEEKLY_HYSTERESIS.holdScore,
      bootstrap: false,
    });
    expect(audit.retained.map(r => r.ticker)).toEqual(['S53']);
    expect(audit.retained[0]).toMatchObject({ profile: 'DEFENSIVE', action: 'BUY' });
    expect(audit.retained[0].displaced.ticker).toBe('S43'); // o menor não-incumbente
    expect(audit.counts).toMatchObject({ seats: 10, maxRetentions: 3, retained: 1 });
  });

  it('a auditoria carrega o motivo escrito de cada incumbente que saiu', () => {
    let audit = null;
    const previous = [
      ...previousWithIncumbent(),
      { ticker: 'SUMIU3', name: 'SUMIU3', score: 80, action: 'BUY', riskProfile: 'DEFENSIVE', position: 11 },
    ];
    buildBrasil10(stocks, fiis, { previous, onRetentionAudit: a => { audit = a; } });
    const exit = audit.exits.find(e => e.ticker === 'SUMIU3');
    expect(exit.reason).toMatch(/não apareceu entre os ativos avaliados/);
  });
});

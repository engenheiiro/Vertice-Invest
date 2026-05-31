/**
 * T6 — aiResearchService: delta vs relatório anterior (generateComparisonReport).
 * Função pura. As dependências pesadas do módulo (Gemini, models, services) são
 * mockadas só para o import do módulo não tocar rede/DB.
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

const { generateComparisonReport } = await import('../services/aiResearchService.js');

const prev = [
  { ticker: 'AAA3', name: 'AAA', score: 72, action: 'BUY', riskProfile: 'MODERATE', position: 1 },
  { ticker: 'BBB3', name: 'BBB', score: 65, action: 'WAIT', riskProfile: 'DEFENSIVE', position: 2 },
  { ticker: 'CCC3', name: 'CCC', score: 80, action: 'BUY', riskProfile: 'BOLD', position: 3 },
  { ticker: 'DDD3', name: 'DDD', score: 55, action: 'WAIT', riskProfile: 'MODERATE', position: 4 },
];

const next = [
  { ticker: 'BBB3', name: 'BBB', score: 75, action: 'BUY', riskProfile: 'DEFENSIVE', position: 1, sector: 'Energia' },
  { ticker: 'AAA3', name: 'AAA', score: 66, action: 'WAIT', riskProfile: 'MODERATE', position: 2, sector: 'Bancos' },
  { ticker: 'DDD3', name: 'DDD', score: 56, action: 'WAIT', riskProfile: 'MODERATE', position: 3, sector: 'Tech' },
  { ticker: 'EEE3', name: 'EEE', score: 90, action: 'BUY', riskProfile: 'BOLD', position: 4, sector: 'Cripto' },
];

describe('generateComparisonReport — sem base anterior', () => {
  it('retorna null quando não há ranking anterior', () => {
    expect(generateComparisonReport('STOCK', next, null)).toBeNull();
    expect(generateComparisonReport('STOCK', next, [])).toBeNull();
  });
});

describe('generateComparisonReport — deltas', () => {
  const report = generateComparisonReport('STOCK', next, prev);

  it('detecta entradas novas e saídas', () => {
    expect(report.newEntries.map((e) => e.ticker)).toEqual(['EEE3']);
    expect(report.exits.map((e) => e.ticker)).toEqual(['CCC3']);
  });

  it('detecta upgrade (WAIT→BUY) e downgrade (BUY→WAIT)', () => {
    expect(report.upgrades.map((u) => u.ticker)).toEqual(['BBB3']);
    expect(report.downgrades.map((d) => d.ticker)).toEqual(['AAA3']);
  });

  it('lista biggestMovers por variação de score >= 5', () => {
    const movers = report.biggestMovers.map((m) => m.ticker).sort();
    expect(movers).toEqual(['AAA3', 'BBB3']); // +10 e -6; DDD3 (+1) fica de fora
    const bbb = report.biggestMovers.find((m) => m.ticker === 'BBB3');
    expect(bbb.scoreDelta).toBe(10);
  });

  it('topBuys traz apenas ações com action=BUY', () => {
    expect(report.topBuys.map((b) => b.ticker)).toEqual(['BBB3', 'EEE3']);
  });

  it('summary consolida as contagens', () => {
    expect(report.summary).toMatchObject({
      totalAssets: 4,
      newEntries: 1,
      exits: 1,
      upgrades: 1,
      downgrades: 1,
      positionChanges: 2,
    });
  });
});

describe('generateComparisonReport — mover por posição', () => {
  it('inclui ativo que saltou >= 3 posições mesmo com score estável', () => {
    const p = [{ ticker: 'JMP3', name: 'JMP', score: 70, action: 'BUY', position: 5 }];
    const n = [{ ticker: 'JMP3', name: 'JMP', score: 70.5, action: 'BUY', position: 1 }];
    const r = generateComparisonReport('STOCK', n, p);
    expect(r.biggestMovers.map((m) => m.ticker)).toContain('JMP3'); // posChange = 4
  });
});

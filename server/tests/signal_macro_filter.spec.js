/**
 * 2.7 — Filtro macro do signalEngine (veto em dia de crash).
 *
 * O quant_regression.spec.js cobre o caminho feliz do runScanner (gera o sinal
 * RSI). A parte NÃO testada era a defesa macro: o "veto" que impede o robô de
 * comprar na queda de uma faca (mercado/petróleo/minério em pânico). Aqui
 * cobrimos toda a árvore de decisão de isValidCorrelation + getMacroContext,
 * mais os auxiliares puros (RSI, perfil de risco, urgência).
 *
 * 100% determinístico: externalMarketService é mockado (sem rede/DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signalEngine } from '../services/engines/signalEngine.js';
import { externalMarketService } from '../services/externalMarketService.js';

vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Contexto macro neutro reutilizável (nenhum gatilho de veto ativo).
const NEUTRAL = {
  oilChange: 0,
  ibovChange: 0,
  spxChange: 0,
  isCrashDay: false,
  isUSCrashDay: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isValidCorrelation — mercado BR ────────────────────────────────────────
describe('isValidCorrelation — veto de crash (Brasil)', () => {
  it('em dia normal qualquer sinal é válido', () => {
    expect(signalEngine.isValidCorrelation('WEGE3', 'RSI_OVERSOLD', NEUTRAL, 'STOCK').valid).toBe(true);
    expect(signalEngine.isValidCorrelation('WEGE3', 'DEEP_VALUE', NEUTRAL, 'STOCK').valid).toBe(true);
  });

  it('crash do IBOV (<-2.5%) VETA sinais que não sejam de sobrevenda', () => {
    const crash = { ...NEUTRAL, ibovChange: -3.2, isCrashDay: true };
    const res = signalEngine.isValidCorrelation('WEGE3', 'DEEP_VALUE', crash, 'STOCK');
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/Pânico/i);
  });

  it('crash do IBOV NÃO veta RSI_OVERSOLD (sobrevenda é exceção)', () => {
    const crash = { ...NEUTRAL, ibovChange: -3.2, isCrashDay: true };
    // A tese de sobrevenda quer justamente comprar no pânico → segue válida.
    expect(signalEngine.isValidCorrelation('WEGE3', 'RSI_OVERSOLD', crash, 'STOCK').valid).toBe(true);
  });
});

// ─── isValidCorrelation — setoriais (petróleo / minério) ────────────────────
describe('isValidCorrelation — vetos setoriais', () => {
  it('petroleira é vetada quando o petróleo cai forte (<-1.5%)', () => {
    const oilDown = { ...NEUTRAL, oilChange: -2.4 };
    const res = signalEngine.isValidCorrelation('PETR4', 'RSI_OVERSOLD', oilDown, 'STOCK');
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/Petróleo/i);
  });

  it('petroleira NÃO é vetada se o petróleo cai pouco (>-1.5%)', () => {
    const oilSoft = { ...NEUTRAL, oilChange: -1.0 };
    expect(signalEngine.isValidCorrelation('PRIO3', 'RSI_OVERSOLD', oilSoft, 'STOCK').valid).toBe(true);
  });

  it('ticker não-petroleiro ignora a queda do petróleo', () => {
    const oilDown = { ...NEUTRAL, oilChange: -5 };
    expect(signalEngine.isValidCorrelation('ITUB4', 'RSI_OVERSOLD', oilDown, 'STOCK').valid).toBe(true);
  });

  it('VALE é vetada em tendência macro negativa forte (IBOV <-2.0%)', () => {
    const macroWeak = { ...NEUTRAL, ibovChange: -2.3 };
    const res = signalEngine.isValidCorrelation('VALE3', 'RSI_OVERSOLD', macroWeak, 'STOCK');
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/macro negativa/i);
  });

  it('VALE passa quando o IBOV recua pouco (>-2.0%)', () => {
    const macroSoft = { ...NEUTRAL, ibovChange: -1.0 };
    expect(signalEngine.isValidCorrelation('VALE3', 'RSI_OVERSOLD', macroSoft, 'STOCK').valid).toBe(true);
  });
});

// ─── isValidCorrelation — mercado americano (STOCK_US) ──────────────────────
describe('isValidCorrelation — veto de crash (EUA)', () => {
  it('crash do S&P (<-2.5%) veta sinais não-sobrevenda de STOCK_US', () => {
    const usCrash = { ...NEUTRAL, spxChange: -3.0, isUSCrashDay: true };
    const res = signalEngine.isValidCorrelation('AAPL', 'DEEP_VALUE', usCrash, 'STOCK_US');
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/S&P 500/i);
  });

  it('crash do S&P NÃO veta RSI_OVERSOLD de STOCK_US', () => {
    const usCrash = { ...NEUTRAL, spxChange: -3.0, isUSCrashDay: true };
    expect(signalEngine.isValidCorrelation('AAPL', 'RSI_OVERSOLD', usCrash, 'STOCK_US').valid).toBe(true);
  });

  it('STOCK_US em dia normal é sempre válido (curto-circuita o filtro BR)', () => {
    // Mesmo com petróleo despencando, a regra de STOCK_US retorna cedo.
    const oilDown = { ...NEUTRAL, oilChange: -9 };
    expect(signalEngine.isValidCorrelation('PETR4', 'RSI_OVERSOLD', oilDown, 'STOCK_US').valid).toBe(true);
  });
});

// ─── getMacroContext — leitura de índices e detecção de crash ───────────────
describe('getMacroContext — detecção de pânico', () => {
  it('marca isCrashDay/isUSCrashDay quando os índices despencam', async () => {
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'BZ=F', change: -3 },
      { ticker: 'BVSP', change: -3.5 },
      { ticker: 'GSPC', change: -4.1 },
    ]);
    const ctx = await signalEngine.getMacroContext();
    expect(ctx.oilChange).toBe(-3);
    expect(ctx.ibovChange).toBe(-3.5);
    expect(ctx.spxChange).toBe(-4.1);
    expect(ctx.isCrashDay).toBe(true);
    expect(ctx.isUSCrashDay).toBe(true);
  });

  it('dia calmo: nenhum flag de crash ativado', async () => {
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'BZ=F', change: 0.5 },
      { ticker: 'BVSP', change: 1.2 },
      { ticker: 'GSPC', change: -1.0 }, // queda leve, acima de -2.5
    ]);
    const ctx = await signalEngine.getMacroContext();
    expect(ctx.isCrashDay).toBe(false);
    expect(ctx.isUSCrashDay).toBe(false);
  });

  it('-2.5% exato NÃO é crash (limiar é estritamente menor)', async () => {
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'BVSP', change: -2.5 },
      { ticker: 'GSPC', change: -2.5 },
    ]);
    const ctx = await signalEngine.getMacroContext();
    expect(ctx.isCrashDay).toBe(false);
    expect(ctx.isUSCrashDay).toBe(false);
  });

  it('falha de rede → contexto neutro (não derruba a varredura)', async () => {
    externalMarketService.getQuotes.mockRejectedValue(new Error('timeout'));
    const ctx = await signalEngine.getMacroContext();
    expect(ctx).toEqual(NEUTRAL);
  });

  it('índices ausentes na resposta → zeros e sem crash', async () => {
    externalMarketService.getQuotes.mockResolvedValue([]); // nenhum índice retornado
    const ctx = await signalEngine.getMacroContext();
    expect(ctx).toEqual(NEUTRAL);
  });
});

// ─── Auxiliares puros (urgência, RSI, perfil de risco) ──────────────────────
describe('_rsiUrgency — escalonamento de urgência', () => {
  it('RSI < 20 = CRITICAL, < 30 = HIGH, demais = MEDIUM', () => {
    expect(signalEngine._rsiUrgency(15)).toBe('CRITICAL');
    expect(signalEngine._rsiUrgency(25)).toBe('HIGH');
    expect(signalEngine._rsiUrgency(45)).toBe('MEDIUM');
  });
});

describe('_grahamUrgency — desconto vs valor intrínseco', () => {
  it('< 0.55 = CRITICAL, < 0.70 = HIGH, demais = MEDIUM', () => {
    expect(signalEngine._grahamUrgency(0.5)).toBe('CRITICAL');
    expect(signalEngine._grahamUrgency(0.65)).toBe('HIGH');
    expect(signalEngine._grahamUrgency(0.8)).toBe('MEDIUM');
  });
});

describe('calculateRSI — limites e cálculo', () => {
  it('série curta (< period+1) retorna null', () => {
    expect(signalEngine.calculateRSI([10, 11, 12], 14)).toBeNull();
  });

  it('sem perdas (preços sempre subindo) → RSI 100', () => {
    // closes[i] - closes[i+1] sempre > 0 (série já vem do mais recente p/ o mais antigo).
    const onlyGains = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16];
    expect(signalEngine.calculateRSI(onlyGains, 14)).toBe(100);
  });

  it('sobrevenda (queda forte e contínua) → RSI baixo (<30)', () => {
    const crash = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    const rsi = signalEngine.calculateRSI(crash, 14);
    expect(rsi).toBeLessThan(30);
  });
});

describe('determineRiskProfile — classificação por tipo/setor', () => {
  it('FII é sempre MODERATE', () => {
    expect(signalEngine.determineRiskProfile({ type: 'FII', sector: 'Logística' })).toBe('MODERATE');
  });
  it('setor defensivo BR (ex.: Bancos) → DEFENSIVE', () => {
    expect(signalEngine.determineRiskProfile({ type: 'STOCK', sector: 'Bancos' })).toBe('DEFENSIVE');
  });
  it('setor defensivo muito alavancado (D/E > 3.5, fora de Bancos) cai para MODERATE', () => {
    expect(
      signalEngine.determineRiskProfile({ type: 'STOCK', sector: 'Elétricas', debtToEquity: 4 })
    ).toBe('MODERATE');
  });
  it('small cap (marketCap < 2B) fora de setor defensivo → BOLD', () => {
    expect(
      signalEngine.determineRiskProfile({ type: 'STOCK', sector: 'Tecnologia', marketCap: 1_000_000_000 })
    ).toBe('BOLD');
  });
  it('large cap fora de setor defensivo → MODERATE', () => {
    expect(
      signalEngine.determineRiskProfile({ type: 'STOCK', sector: 'Tecnologia', marketCap: 50_000_000_000 })
    ).toBe('MODERATE');
  });
  it('STOCK_US defensivo (ex.: Utilities) → DEFENSIVE; mega cap → MODERATE; demais → BOLD', () => {
    expect(signalEngine.determineRiskProfile({ type: 'STOCK_US', sector: 'Utilities' })).toBe('DEFENSIVE');
    expect(
      signalEngine.determineRiskProfile({ type: 'STOCK_US', sector: 'Technology', marketCap: 60_000_000_000 })
    ).toBe('MODERATE');
    expect(
      signalEngine.determineRiskProfile({ type: 'STOCK_US', sector: 'Technology', marketCap: 1_000_000_000 })
    ).toBe('BOLD');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// GoogleGenAI é instanciado com `new` no load do serviço; um mock com arrow fn
// não é construível ("() => ({}) is not a constructor"). Class mock resolve.
vi.mock('@google/genai', () => ({ GoogleGenAI: class { constructor() {} } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { applyAiRiskAssessment } = await import('../services/aiEnhancementService.js');

const candidate = (ticker, score) => ({
  ticker,
  score,
  action: score >= 70 ? 'BUY' : 'WAIT',
  riskProfile: 'DEFENSIVE',
  thesis: 'Tese quant',
  bullThesis: [],
  metrics: { structural: { quality: 50, valuation: 50, risk: 50 } },
});

beforeEach(() => vi.clearAllMocks());

describe('IA qualitativa — contrato de riskVeto separado', () => {
  it('risco crítico sinaliza veto, mas BUY continua derivado do score', () => {
    const out = applyAiRiskAssessment([candidate('AAA3', 80)], [{
      ticker: 'AAA3',
      riskLevel: 'CRITICAL',
      rationale: 'Recuperação judicial confirmada.',
      hasBankruptcyRisk: true,
    }]);
    expect(out[0].action).toBe('BUY');
    expect(out[0].riskVeto.active).toBe(true);
    expect(out[0].riskVeto.level).toBe('CRITICAL');
  });

  it('IA não promove score 69 e contrato renumera o ranking', () => {
    const out = applyAiRiskAssessment([candidate('WAIT3', 69)], [{
      ticker: 'WAIT3', riskLevel: 'LOW', rationale: 'Sem alerta.', hasBankruptcyRisk: false,
    }]);
    expect(out[0].action).toBe('WAIT');
    expect(out[0].position).toBe(1);
    expect(out[0].riskVeto.active).toBe(false);
  });
});

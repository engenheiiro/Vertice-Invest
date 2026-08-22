import { describe, expect, it } from 'vitest';
import { betaResilience, passesBuyAndHoldGate, resolveMaxBeta } from '../services/engines/buyAndHoldEngine.js';
import { BANK_MAX_BETA, BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';

// Fixtures ancoradas em dados reais do snapshot 2026-07-20.
const abcb4 = {
  ticker: 'ABCB4', name: 'Banco ABC Brasil S.A.', sector: 'Bancos', stockArchetype: 'BANK', isTier1: false,
  metrics: { marketCap: 6_146_927_400, beta: 0.82, avgLiquidity: 17_453_700, roe: 14.08, structural: { quality: 20, valuation: 100, risk: 60 } },
  sectorMetrics: { roeTtm: 22.19, capitalRatio: 15.83, controlType: 'PRIVATE' },
};

const brav3 = {
  ticker: 'BRAV3', name: 'Brava Energia S.A.', sector: 'Petróleo', stockArchetype: 'OIL_GAS_PRODUCER',
  metrics: { marketCap: 9_128_000_000, beta: 0.80, avgLiquidity: 80_000_000, roe: 2.04, structural: { quality: 0, valuation: 30, risk: 60 } },
  sectorMetrics: { controlType: 'PRIVATE' },
};

const pssa3 = {
  ticker: 'PSSA3', name: 'Porto Seguro S.A.', sector: 'Seguros', stockArchetype: 'INSURER',
  metrics: { marketCap: 35_577_211_000, beta: 0.73, avgLiquidity: 100_000_000, roe: 23.7, structural: { quality: 80, valuation: 55, risk: 80 } },
  sectorMetrics: { solvencyRatio: 152.06, combinedRatio: 88.7, recurringEarningsGrowth: 15, controlType: 'PRIVATE' },
};

describe('passesBuyAndHoldGate', () => {
  // A flag `isTier1` só é populada para FIIs de elite e mega caps US, então exigi-la
  // reprovava TODO banco brasileiro. O portão passou a medir Basileia e ROE recorrente.
  it('aprova banco sólido mesmo sem a flag isTier1 (ABCB4)', () => {
    const gate = passesBuyAndHoldGate(abcb4, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(gate.archetype).toBe('BANK');
  });

  it('reprova banco com Basileia abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({
      ...abcb4,
      sectorMetrics: { ...abcb4.sectorMetrics, capitalRatio: 11.2 },
    }, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('Basileia'))).toBe(true);
  });

  it('reprova banco com ROE recorrente abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({
      ...abcb4,
      sectorMetrics: { ...abcb4.sectorMetrics, roeTtm: 6.5 },
    }, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('ROE recorrente'))).toBe(true);
  });

  it('exclui setor cíclico (BRAV3 / Petróleo)', () => {
    const gate = passesBuyAndHoldGate(brav3, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('setor cíclico');
  });

  it('aprova seguradora de qualidade no portão (PSSA3)', () => {
    const gate = passesBuyAndHoldGate(pssa3, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(gate.archetype).toBe('INSURER');
  });

  it('reprova por beta acima do teto', () => {
    const gate = passesBuyAndHoldGate({ ...pssa3, metrics: { ...pssa3.metrics, beta: 1.4 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('beta'))).toBe(true);
  });

  it('reprova por market cap abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({ ...pssa3, metrics: { ...pssa3.metrics, marketCap: 1_000_000_000 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('market cap'))).toBe(true);
  });

  it('respeita allowTickers para setor limítrofe não-cíclico', () => {
    const borderline = {
      ...pssa3, ticker: 'XPTO3', sector: 'Saúde', stockArchetype: 'OPERATIONAL',
      sectorMetrics: { controlType: 'PRIVATE' },
    };
    // 'Saúde' não é cíclico, mas está fora do allowlist de setores âncora.
    expect(passesBuyAndHoldGate(borderline).passed).toBe(false);
    const withAllow = passesBuyAndHoldGate(borderline, { ...BUY_AND_HOLD_CONFIG, allowTickers: ['XPTO3'] });
    expect(withAllow.passed).toBe(true);
  });

  it('respeita denyTickers mesmo com fundamentos aprovados', () => {
    const gate = passesBuyAndHoldGate(pssa3, { ...BUY_AND_HOLD_CONFIG, denyTickers: ['PSSA3'] });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('denylist manual');
  });
});

// ---------------------------------------------------------------------------
// Teto de beta POR ARQUÉTIPO. Com 1,00 valendo para todo mundo, os seis maiores
// bancos do país ficavam fora por um único motivo — "beta acima de 1" — nenhum
// por fundamento. Banco é proxy do ciclo econômico local: cobrar dele o teto de
// uma transmissora é comparar coisas diferentes. Betas reais de 22/08/2026.
// ---------------------------------------------------------------------------
describe('teto de beta por arquétipo', () => {
  const bank = (ticker, beta) => ({
    ...abcb4, ticker, metrics: { ...abcb4.metrics, beta },
  });

  it.each([
    ['BRSR6', 1.0110],
    ['BBAS3', 1.0663],
    ['ITUB4', 1.1079],
    ['SANB11', 1.1506],
  ])('banco sólido acima de 1,0 entra no universo âncora (%s, beta %f)', (ticker, beta) => {
    const gate = passesBuyAndHoldGate(bank(ticker, beta), BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
  });

  it.each([
    ['BBDC4', 1.2717],
    ['BPAC11', 1.4762],
  ])('banco acima do teto próprio continua fora (%s, beta %f)', (ticker, beta) => {
    const gate = passesBuyAndHoldGate(bank(ticker, beta), BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain(`beta acima de ${BANK_MAX_BETA}`);
  });

  // O teto do banco não vaza para o resto: uma utility em 1,01 segue fora. Foi a
  // razão de o teto ser por arquétipo em vez de simplesmente subir maxBeta.
  it('operacional acima de 1,0 continua fora — o teto do banco não é geral', () => {
    const utility = {
      ...pssa3, ticker: 'CPLE3', sector: 'Saneamento', stockArchetype: 'OPERATIONAL',
      metrics: { ...pssa3.metrics, beta: 1.0743 },
      sectorMetrics: { controlType: 'STATE_DIRECT' },
    };
    const gate = passesBuyAndHoldGate(utility, BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('beta acima de 1');
  });

  it('seguradora segue no teto padrão (1,0), não no do banco', () => {
    expect(resolveMaxBeta('INSURER', BUY_AND_HOLD_CONFIG)).toBe(BUY_AND_HOLD_CONFIG.gate.maxBeta);
    expect(resolveMaxBeta('BANK', BUY_AND_HOLD_CONFIG)).toBe(BANK_MAX_BETA);
    // Arquétipo desconhecido nunca "herda" folga: cai no padrão.
    expect(resolveMaxBeta('QUALQUER_COISA', BUY_AND_HOLD_CONFIG)).toBe(BUY_AND_HOLD_CONFIG.gate.maxBeta);
  });

  // Beta ausente é AUSENTE, e ausente não vira aprovação de graça.
  it('beta ausente reprova mesmo em banco', () => {
    const gate = passesBuyAndHoldGate(
      { ...abcb4, metrics: { ...abcb4.metrics, beta: null } },
      BUY_AND_HOLD_CONFIG,
    );
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('beta'))).toBe(true);
  });
});

// A rampa é o que impede o teto de ser um degrau puro: dentro da faixa
// permitida, beta mais alto vale menos resiliência. A escala é ABSOLUTA — o teto
// por arquétipo é tolerância de admissão e fica no portão, não na nota.
describe('rampa de beta dentro do portão', () => {
  it('banco perto do teto pontua menos que banco de beta baixo', () => {
    const calmo = betaResilience({ metrics: { beta: 0.82 } }, BUY_AND_HOLD_CONFIG);
    const nervoso = betaResilience({ metrics: { beta: 1.19 } }, BUY_AND_HOLD_CONFIG);
    expect(calmo).toBeGreaterThan(nervoso);
    expect(nervoso).toBeGreaterThanOrEqual(0);
  });

  it('a fronteira do teto não é o único discriminador — beta baixo vale mais', () => {
    // Três betas admissíveis, todos longe de qualquer teto: a nota tem que
    // ordená-los, senão a rampa não está fazendo trabalho nenhum.
    const notas = [0.70, 0.85, 1.00].map(beta => betaResilience({ metrics: { beta } }, BUY_AND_HOLD_CONFIG));
    expect(notas[0]).toBeGreaterThan(notas[1]);
    expect(notas[1]).toBeGreaterThan(notas[2]);
  });

  it('mesmo beta vale a mesma nota em qualquer arquétipo', () => {
    // Antes a nota vinha da distância até o teto do arquétipo, então 0,95 valia
    // mais para banco (teto 1,20) que para operacional (teto 1,00) — a folga de
    // admissão era concedida uma segunda vez, dentro do score.
    const semArquetipo = betaResilience({ metrics: { beta: 0.95 } }, BUY_AND_HOLD_CONFIG);
    const comBanco = betaResilience({ ticker: 'BBAS3', metrics: { beta: 0.95 } }, BUY_AND_HOLD_CONFIG);
    expect(comBanco).toBe(semArquetipo);
  });

  it('nenhum teto de arquétipo passa do pior beta da escala', () => {
    // Um teto acima de BETA_SCALE.worst clampa a nota em 0 para todo o arquétipo,
    // matando a rampa dele em silêncio. Falhar aqui é mais barato que descobrir
    // depois num ranking em que todo banco tirou zero de beta.
    const { betaScale, maxBeta, maxBetaByArchetype } = BUY_AND_HOLD_CONFIG.gate;
    const tetos = [maxBeta, ...Object.values(maxBetaByArchetype)];
    for (const teto of tetos) expect(teto).toBeLessThanOrEqual(betaScale.worst);
  });

  it('beta ausente vira AUSENTE (null), nunca nota zero', () => {
    expect(betaResilience({ metrics: {} }, BUY_AND_HOLD_CONFIG)).toBeNull();
    expect(betaResilience({ metrics: { beta: null } }, BUY_AND_HOLD_CONFIG)).toBeNull();
  });
});

describe('arquétipo ausente', () => {
  it('banco sem stockArchetype é julgado como banco, não como operacional', () => {
    // Sem a dedução, o portão cobraria DL/EBITDA em vez de Basileia e aplicaria
    // teto de beta 1,00 — reprovando por volatilidade um banco que o teto de
    // banco admite. BPAN4 está assim no banco de dados hoje.
    const semCampo = { ...abcb4, ticker: 'BPAN4', stockArchetype: undefined };
    expect(passesBuyAndHoldGate(semCampo).archetype).toBe('BANK');
  });

  it('operacional sem stockArchetype continua OPERATIONAL — o vazio é o normal delas', () => {
    const utility = {
      ...pssa3, ticker: 'TAEE11', name: 'Taesa', sector: 'Energia Elétrica', stockArchetype: undefined,
    };
    expect(passesBuyAndHoldGate(utility).archetype).toBe('OPERATIONAL');
  });

  it('o campo explícito continua tendo precedência sobre a dedução', () => {
    const forcado = { ...abcb4, stockArchetype: 'OPERATIONAL' };
    expect(passesBuyAndHoldGate(forcado).archetype).toBe('OPERATIONAL');
  });
});

// O par que expôs o defeito da ancoragem por arquétipo (medição de 22/08/2026).
describe('holding não é punida pela volatilidade que o controlado é perdoado', () => {
  it('Itaúsa (beta 0,923) tira nota MAIOR que Itaú (beta 1,108)', () => {
    const itsa4 = betaResilience({ ticker: 'ITSA4', metrics: { beta: 0.9234 } }, BUY_AND_HOLD_CONFIG);
    const itub4 = betaResilience({ ticker: 'ITUB4', metrics: { beta: 1.1079 } }, BUY_AND_HOLD_CONFIG);
    expect(itsa4).toBeGreaterThan(itub4);
  });
});

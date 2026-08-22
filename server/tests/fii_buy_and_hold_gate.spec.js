import { describe, expect, it } from 'vitest';
import { passesBuyAndHoldGate, resolveFiiSubType } from '../services/engines/fiiBuyAndHoldEngine.js';
import { FII_BUY_AND_HOLD_CONFIG } from '../config/fiiBuyAndHold.js';

// Fixtures ancoradas na base de produção de 22/08/2026 (após o sync que consertou
// a ingestão de FFO, commit 9bd589f). Números reais, não sintéticos.
const fii = ({ ticker, name, sector, fiiSubType, isTier1 = false, marketCap, liquidity, dy, vacancy = 0, qtdImoveis = 0, ffoYield = 0, ffoCota = 0, price = 100, volatility = 10 }) => ({
  ticker, name, sector, fiiSubType, isTier1, currentPrice: price,
  metrics: {
    marketCap, avgLiquidity: liquidity, dy, vacancy, qtdImoveis, ffoYield, ffoCota,
    price, volatility, sector, fiiSubType, structural: { quality: 60, valuation: 60, risk: 60 },
  },
});

const hglg11 = fii({
  ticker: 'HGLG11', name: 'Cshg Logistica - Fundo De Investimento Imobiliario',
  sector: 'Logística', fiiSubType: 'TIJOLO', isTier1: true,
  marketCap: 6_713_030_000, liquidity: 17_560_600, dy: 8.1, vacancy: 3.23, qtdImoveis: 60,
  ffoYield: 6.61, ffoCota: 9.73, price: 147.21, volatility: 7.09,
});

const knsc11 = fii({
  ticker: 'KNSC11', name: 'Kinea Securities Fundo De Investimento Imobiliario – Fii',
  sector: 'Papel', fiiSubType: 'PAPEL', isTier1: true,
  marketCap: 1_821_840_000, liquidity: 4_333_200, dy: 11.25,
  ffoYield: 13.68, ffoCota: 1.23, price: 9.01, volatility: 9.56,
});

// FII de papel de porte e liquidez sobrando, mas SEM a curadoria tier-1.
const mxrf11 = fii({
  ticker: 'MXRF11', name: 'Maxi Renda Fundo De Investimento Imobiliaro - FII',
  sector: 'Híbrido', fiiSubType: 'PAPEL', isTier1: false,
  marketCap: 4_262_100_000, liquidity: 16_538_700, dy: 12.64,
  ffoYield: 11.33, ffoCota: 1.05, price: 9.26, volatility: 9.07,
});

// Fundo de desenvolvimento: renda futura, risco de obra — e DY de 20,66%.
const tgar11 = fii({
  ticker: 'TGAR11', name: 'Fundo Investimento Imobiliario TG Ativo Real',
  sector: 'Desenvolvimento', fiiSubType: 'DESENVOLVIMENTO',
  marketCap: 1_034_630_000, liquidity: 3_747_760, dy: 20.66, qtdImoveis: 4,
  ffoYield: 24.16, ffoCota: 10.61, price: 43.9, volatility: 28.22,
});

const rvbi11 = fii({
  ticker: 'RVBI11', name: 'Patria Securities Fundo de Investimento Imobiliario',
  sector: 'Fundo de Fundos', fiiSubType: 'FOF',
  marketCap: 615_533_000, liquidity: 931_734, dy: 14.1, price: 8,
});

const rztr11 = fii({
  ticker: 'RZTR11', name: 'Fundo De Investimento Imobiliario Riza Terrax',
  sector: 'Fiagro', fiiSubType: 'FIAGRO',
  marketCap: 1_589_770_000, liquidity: 3_087_350, dy: 12.65, price: 9,
});

describe('passesBuyAndHoldGate (FII) — natureza do fundo', () => {
  it('aprova tijolo de renda em segmento âncora (HGLG11)', () => {
    const gate = passesBuyAndHoldGate(hglg11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(gate.subType).toBe('TIJOLO');
    expect(gate.isPaper).toBe(false);
  });

  it('aprova FII de papel tier-1 (KNSC11)', () => {
    const gate = passesBuyAndHoldGate(knsc11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(gate.isPaper).toBe(true);
  });

  // Núcleo da "configuração B": sem esta trava o portão ampla deixava 28 FIIs de
  // papel entrarem — concentração inaceitável em crédito num ranking âncora.
  it('barra FII de papel fora do tier-1, por maior que seja (MXRF11, R$ 4,2 bi)', () => {
    const gate = passesBuyAndHoldGate(mxrf11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('FII de papel fora do tier-1');
  });

  it('barra fundo de desenvolvimento (TGAR11)', () => {
    const gate = passesBuyAndHoldGate(tgar11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.includes('desenvolvimento'))).toBe(true);
  });

  it('barra fundo de fundos (RVBI11)', () => {
    const gate = passesBuyAndHoldGate(rvbi11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.includes('fof'))).toBe(true);
  });

  it('barra FIAGRO (RZTR11) — crédito agrícola não é imóvel de renda', () => {
    const gate = passesBuyAndHoldGate(rztr11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.includes('fiagro'))).toBe(true);
  });

  it('barra fundo com prazo determinado ou em amortização pelo nome', () => {
    const gate = passesBuyAndHoldGate(
      { ...hglg11, name: 'Fundo Imobiliário Alfa - Em Amortização' },
      FII_BUY_AND_HOLD_CONFIG,
    );
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('fundo com prazo determinado ou em amortização');
  });
});

describe('passesBuyAndHoldGate (FII) — armadilha de yield', () => {
  // HGPO11 na base: DY de 126%, patrimônio de R$ 269 M. DY assim é amortização
  // ou evento não recorrente, nunca renda.
  it('barra DY estratosférico mesmo em segmento e porte aceitáveis', () => {
    const trap = fii({
      ticker: 'TRAP11', name: 'Fundo Armadilha', sector: 'Shoppings', fiiSubType: 'TIJOLO',
      marketCap: 2_000_000_000, liquidity: 5_000_000, dy: 43.03, vacancy: 2, qtdImoveis: 10, price: 50,
    });
    const gate = passesBuyAndHoldGate(trap, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('armadilha de yield'))).toBe(true);
  });

  it('barra fundo sem renda corrente (DY abaixo do piso)', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, metrics: { ...hglg11.metrics, dy: 2.39 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('DY abaixo'))).toBe(true);
  });
});

describe('passesBuyAndHoldGate (FII) — pisos quantitativos', () => {
  it('barra patrimônio abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, metrics: { ...hglg11.metrics, marketCap: 268_954_000 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('patrimônio'))).toBe(true);
  });

  it('barra liquidez abaixo do piso', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, metrics: { ...hglg11.metrics, avgLiquidity: 220_426 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('liquidez'))).toBe(true);
  });

  // XPML11 chega da fonte com vacância de 91,81%. Certo ou errado o dado, o
  // portão é fail-closed: não se carrega âncora com vacância que não se explica.
  it('barra vacância acima do teto (XPML11, 91,81% na fonte)', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, ticker: 'XPML11', metrics: { ...hglg11.metrics, vacancy: 91.81 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('vacância'))).toBe(true);
  });

  it('barra mono-ativo de tijolo', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, metrics: { ...hglg11.metrics, qtdImoveis: 1 } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('menos de'))).toBe(true);
  });

  // Vacância e nº de imóveis não existem para um FII de CRI: cobrá-los seria
  // reprovar por dado estruturalmente inexistente (mesmo princípio do teto de
  // confiança de FII no scoringEngine).
  it('não cobra vacância nem imóveis de FII de papel', () => {
    const gate = passesBuyAndHoldGate(knsc11, FII_BUY_AND_HOLD_CONFIG);
    expect(gate.passed).toBe(true);
    expect(knsc11.metrics.qtdImoveis).toBe(0);
  });

  it('alavancagem é fail-open: ausente não reprova, presente e estourada reprova', () => {
    expect(passesBuyAndHoldGate(hglg11).passed).toBe(true); // sem o dado
    const levered = { ...hglg11, metrics: { ...hglg11.metrics, leverage: 45 } };
    const gate = passesBuyAndHoldGate(levered);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('alavancagem'))).toBe(true);
  });
});

describe('passesBuyAndHoldGate (FII) — segmento e curadoria', () => {
  it('barra segmento vago fora do universo âncora (Multicategoria)', () => {
    const gate = passesBuyAndHoldGate({ ...hglg11, sector: 'Multicategoria', metrics: { ...hglg11.metrics, sector: 'Multicategoria' } });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('segmento fora'))).toBe(true);
  });

  it('respeita allowTickers para segmento limítrofe', () => {
    const borderline = { ...hglg11, ticker: 'XPTO11', sector: 'Multicategoria', metrics: { ...hglg11.metrics, sector: 'Multicategoria' } };
    expect(passesBuyAndHoldGate(borderline).passed).toBe(false);
    const withAllow = passesBuyAndHoldGate(borderline, { ...FII_BUY_AND_HOLD_CONFIG, allowTickers: ['XPTO11'] });
    expect(withAllow.passed).toBe(true);
  });

  it('respeita denyTickers mesmo com fundamentos aprovados', () => {
    const gate = passesBuyAndHoldGate(hglg11, { ...FII_BUY_AND_HOLD_CONFIG, denyTickers: ['HGLG11'] });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain('denylist manual');
  });

  // O piso de imóveis é o que separa "híbrido de tijolo" (aceito) de "híbrido de
  // papel" (rejeitado) — não há rótulo na base que faça essa distinção.
  it('híbrido sem imóveis cai no piso de tijolo', () => {
    const paperHybrid = fii({
      ticker: 'HIBP11', name: 'Híbrido de Papel', sector: 'Híbrido', fiiSubType: 'HIBRIDO',
      marketCap: 2_000_000_000, liquidity: 5_000_000, dy: 11, qtdImoveis: 0, price: 10,
    });
    const gate = passesBuyAndHoldGate(paperHybrid);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.startsWith('menos de'))).toBe(true);
  });
});

describe('resolveFiiSubType', () => {
  it('prefere o rótulo explícito de fiiSubType', () => {
    expect(resolveFiiSubType({ fiiSubType: 'PAPEL', sector: 'Logística' })).toBe('PAPEL');
  });

  it('cai no setor quando o rótulo não existe', () => {
    expect(resolveFiiSubType({ sector: 'Recebíveis' })).toBe('PAPEL');
    expect(resolveFiiSubType({ sector: 'Fundo de Fundos' })).toBe('FOF');
    expect(resolveFiiSubType({ sector: 'Fiagro' })).toBe('FIAGRO');
    expect(resolveFiiSubType({ sector: 'Desenvolvimento' })).toBe('DESENVOLVIMENTO');
    expect(resolveFiiSubType({ sector: 'Logística' })).toBe('TIJOLO');
  });
});

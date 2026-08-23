/**
 * UMA RÉGUA SÓ PARA O ROE RECORRENTE.
 *
 * A decisão "qual ROE entra e por qual escala ele é medido" estava duplicada em
 * três lugares com três respostas: o scorer preferia `roeTtm` e o media de 12 a
 * 30; o eixo setorial preferia `roeTtm` e o media de 8 a 25; a âncora misturava
 * ROE recorrente (banco) e ROE contábil (o resto) no MESMO parâmetro e passava
 * a régua de 8 a 25 nos dois. `resolveRoeReading` é a resposta única.
 *
 * Estes testes travam a intenção, não os números do dia: se alguém trouxer uma
 * escala inline de volta para um dos engines, eles quebram.
 */
import { describe, expect, it } from 'vitest';
import {
  GENERIC_ROE_SCALE,
  RECURRING_ROE_SCALE_BY_ARCHETYPE,
  STOCK_ARCHETYPES,
  resolveRoeReading,
} from '../config/stockCalibration.js';
import { computeBuyAndHoldAxes } from '../services/engines/buyAndHoldEngine.js';
import { calculateStockShadowAxes } from '../services/engines/stockSectorAxisEngine.js';

const BANK_SCALE = RECURRING_ROE_SCALE_BY_ARCHETYPE[STOCK_ARCHETYPES.BANK];

const bank = (sectorMetrics = {}, metrics = {}) => ({
  ticker: 'ABCB4',
  sector: 'Bancos',
  stockArchetype: STOCK_ARCHETYPES.BANK,
  metrics: {
    roe: 14.05, marketCap: 6_000_000_000, beta: 0.82, avgLiquidity: 17_000_000,
    structural: { quality: 60, valuation: 60, risk: 60 },
    ...metrics,
  },
  sectorMetrics: {
    roeTtm: 22.19, capitalRatio: 15.83, earningsGrowth: 2.37,
    operatingCostRatio: 73.10, delinquencyRatio: 0.94, controlType: 'PRIVATE',
    ...sectorMetrics,
  },
});

describe('resolveRoeReading — a régua acompanha a fonte', () => {
  it('banco com roeTtm lê o recorrente e traz a régua do recorrente', () => {
    const reading = resolveRoeReading(bank(), STOCK_ARCHETYPES.BANK);
    expect(reading).toEqual({ value: 22.19, scale: BANK_SCALE, recurring: true });
  });

  it('banco SEM roeTtm cai no ROE contábil e traz a régua do contábil', () => {
    const reading = resolveRoeReading(bank({ roeTtm: null }), STOCK_ARCHETYPES.BANK);
    expect(reading).toEqual({ value: 14.05, scale: GENERIC_ROE_SCALE, recurring: false });
  });

  it('operacional nunca é medida pela régua do recorrente', () => {
    const reading = resolveRoeReading(
      { metrics: { roe: 20 } },
      STOCK_ARCHETYPES.OPERATIONAL,
    );
    expect(reading).toEqual({ value: 20, scale: GENERIC_ROE_SCALE, recurring: false });
  });

  it('roe = 0 marcado como não coletado é AUSENTE, não rentabilidade zero', () => {
    // Nota 0 numa escala higherBetter é medição. Campo em branco não pode virar
    // medição — mesma regra do scorer (utils/metricObservation.js).
    const reading = resolveRoeReading(
      { metrics: { roe: 0, _missing: { roe: true } } },
      STOCK_ARCHETYPES.OPERATIONAL,
    );
    expect(reading.value).toBeNull();
  });

  it('as duas réguas são escalas DIFERENTES do mesmo conceito', () => {
    // Se alguém igualar as duas, o recorrente (~1,5x o contábil) volta a levar
    // vantagem de escala em cima do contábil.
    expect(BANK_SCALE.floor).toBeGreaterThan(GENERIC_ROE_SCALE.floor);
    expect(BANK_SCALE.cap).toBeGreaterThan(GENERIC_ROE_SCALE.cap);
  });
});

describe('o mesmo roeTtm é medido pela mesma régua nos dois eixos', () => {
  // Era aqui que a duplicação aparecia: ABCB4 com roeTtm 22,19 valia 83 no eixo
  // setorial (régua 8-25) e 57 na durabilidade âncora depois do commit anterior
  // (régua 12-30). Mesmo número, mesma pergunta, notas diferentes.
  const noteOf = (axes, metric) => axes.audit?.durability?.find(c => c.metric === metric)?.value;

  it('eixo setorial e âncora dão a MESMA nota ao mesmo ROE recorrente', () => {
    const asset = bank();
    const doSetorial = noteOf(calculateStockShadowAxes(asset), 'roeTtm');
    const daAncora = noteOf(computeBuyAndHoldAxes(asset, STOCK_ARCHETYPES.BANK), 'roe');
    // Se algum dos dois deixar de expor componentes, o teste vira inútil em
    // silêncio — falha explicitamente em vez disso.
    expect(doSetorial, 'eixo setorial não expôs o componente roeTtm').toBeDefined();
    expect(daAncora, 'âncora não expôs o componente roe').toBeDefined();
    expect(doSetorial).toBe(daAncora);
  });

  it('a nota do ROE recorrente sobe com o fundamento, sem saturar no p75 medido', () => {
    // O teto antigo (25) ficava ABAIXO do terceiro quartil da base (32,4): quatro
    // bancos empatavam em 100 por estarem fora da escala, não por serem iguais.
    const nota = roeTtm => noteOf(
      computeBuyAndHoldAxes(bank({ roeTtm }), STOCK_ARCHETYPES.BANK), 'roe',
    );
    expect(nota(32.37)).toBeGreaterThan(nota(24.03));
    expect(nota(24.03)).toBeGreaterThan(nota(19.82));
  });
});

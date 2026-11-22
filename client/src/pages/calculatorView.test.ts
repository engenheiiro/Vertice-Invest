import { describe, it, expect } from 'vitest';
import { calcAll, type InstrumentResult } from './calculatorMath';
import {
  normalizeScenario, scenarioTitle, buildScenario, addScenario, toggleCompareList, marketParams, emptyResultMessage,
  dyNote, dyOf, instrumentWhy, instrumentDetailRows, COMPARE_ROWS, barWidth, investedVsGain, type Scenario,
} from './calculatorView';

const MACRO = {
  selic: { value: 15 }, cdi: { value: 14.9 }, ipca: { value: 4.5 }, ntnbLong: { value: 7.2 },
  bonds: [{ title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', rate: 14.13 }],
};
const results = calcAll(10000, 500, 60, MACRO, 9.5, null, 'BBAS3', null);
const byId = (id: string) => results.find(r => r.id === id) as InstrumentResult;
const best = results[0];

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  mode: 'simular', initial: 1000, monthly: 500, months: 24, summary: 's', ...over,
});

describe('cenários salvos', () => {
  it('cenário antigo sem aba nem comparativo vira "simular" com lista vazia', () => {
    const antigo = { initial: 1, monthly: 2, months: 3, summary: 'x' } as Scenario;
    expect(normalizeScenario(antigo)).toMatchObject({ mode: 'simular', compare: [] });
    expect(normalizeScenario(scenario({ mode: 'meta', compare: ['cdb'] }))).toMatchObject({ mode: 'meta', compare: ['cdb'] });
  });

  it('título por aba', () => {
    expect(scenarioTitle(scenario())).toBe('2 anos · R$ 500/mês · R$ 1.000');
    expect(scenarioTitle(scenario({ mode: 'meta', goal: 100000, months: 18 }))).toBe('Meta R$ 100.000 · 1 ano e 6 meses');
  });

  it('salva o comparativo e os tickers; ativo entra só pelo ticker no rótulo', () => {
    const selected = [{ result: byId('cdb'), color: '#1' }, { result: byId('stock-BBAS3'), color: '#2' }];
    const s = buildScenario({ mode: 'simular', initial: 10000, monthly: 500, months: 60, goal: 0, selected, stock: 'BBAS3', fii: null, best });
    expect(s).toMatchObject({ compare: ['cdb', 'stock-BBAS3'], compareLabels: 'CDB · BBAS3', stock: 'BBAS3', fii: null });
    expect(s).not.toHaveProperty('goal');
    expect(s.summary).toBe(`R$ ${Math.round(best.netValue).toLocaleString('pt-BR')} · ${best.label}`);
    const meta = buildScenario({ mode: 'meta', initial: 0, monthly: 1230, months: 60, goal: 100000, selected: [], stock: null, fii: null, best });
    expect(meta).toMatchObject({ goal: 100000, summary: `R$ 1.230/mês · ${best.label}` });
  });

  it('o corte de 5 é por aba: uma aba não come o espaço da outra', () => {
    const metas = [1, 2, 3].map(i => scenario({ mode: 'meta', initial: i }));
    const simulacoes = [1, 2, 3, 4, 5].map(i => scenario({ initial: i }));
    const next = addScenario([...metas, ...simulacoes], scenario({ initial: 6 }));
    expect(next.filter(s => s.mode === 'meta')).toHaveLength(3);
    expect(next.filter(s => s.mode === 'simular').map(s => s.initial)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('toggleCompareList', () => {
  it('entra no fim, no máximo 3 (o mais antigo sai), e o último nunca sai', () => {
    expect(toggleCompareList(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleCompareList(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
    expect(toggleCompareList(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleCompareList(['a'], 'a')).toEqual(['a']);
  });
});

describe('marketParams', () => {
  it('lista só as taxas que chegaram, mais a TR', () => {
    expect(marketParams(MACRO).map(p => p.label)).toEqual([
      'CDI (a.a.)', 'Selic efetiva (a.a.)', 'IPCA (a.a.)', 'Juro real IPCA+ (a.a.)', 'Tesouro Prefixado (a.a.)', 'TR (a.m.) · Poupança',
    ]);
    expect(marketParams({ cdi: { value: 14.9 } })).toEqual([
      { label: 'CDI (a.a.)', value: '14,90%' },
      { label: 'TR (a.m.) · Poupança', value: '0,1708%' },
    ]);
    expect(marketParams(undefined)).toHaveLength(1);
  });
});

describe('estado vazio e DY', () => {
  it('sem taxa diz que as taxas não chegaram; senão, pede o número da aba', () => {
    expect(emptyResultMessage(false, false, false)).toMatch(/não chegaram agora/);
    expect(emptyResultMessage(true, false, true)).toMatch(/aporte necessário/);
    expect(emptyResultMessage(false, true, false)).toMatch(/investimento inicial ou o aporte/);
  });

  it('DY só conta positivo; a linha diz carregando, sem DY ou o DY', () => {
    expect(dyOf({ dy: 9.5 })).toBe(9.5);
    expect(dyOf({ dy: 0 })).toBeNull();
    expect(dyOf(null)).toBeNull();
    expect(dyOf(undefined)).toBeNull();
    expect(dyNote(null, undefined, null)).toBeNull();
    expect(dyNote('BBAS3', undefined, null)).toEqual({ tone: 'muted', text: 'Carregando DY…' });
    expect(dyNote('BBAS3', null, null)).toEqual({ tone: 'muted', text: 'DY não disponível para este ativo' });
    expect(dyNote('BBAS3', { dy: 9.5 }, 9.5)).toEqual({ tone: 'ok', text: 'DY atual: 9,50%' });
  });
});

describe('detalhamento dos cards', () => {
  it('cada tipo de instrumento explica o próprio desconto', () => {
    expect(instrumentWhy(byId('stock-BBAS3'), best, 60)).toMatch(/^Projeção feita só com o rendimento distribuído/);
    expect(instrumentWhy(byId('poupanca'), best, 60)).toMatch(/piso do mercado: fica R\$ [\d.]+ atrás do topo/);
    expect(instrumentWhy(byId('lci-lca'), best, 60)).toMatch(/Mesmo rendendo 85% do CDI/);
    expect(instrumentWhy(byId('fundo-di'), best, 60)).toMatch(/taxa de administração de 0,25% a\.a\..* IR de 15,0%/);
    expect(instrumentWhy(byId('tesouro-selic'), best, 60)).toMatch(/custódia da B3 de 0,20% a\.a\./);
    expect(instrumentWhy(byId('cdb'), best, 60)).toMatch(/^Sem custódia nem taxa de administração/);
  });

  it('linhas: custo ausente vira traço; isento mostra "isento" no IR', () => {
    const lci = instrumentDetailRows(byId('lci-lca'), 60);
    expect(lci.map(r => r.label)).toEqual(['Valor bruto', 'Rent. bruta', 'Custos', 'IR pago (isento)', 'Ganho líquido']);
    expect(lci[2]).toMatchObject({ value: '—', tone: 'text-slate-600' });
    expect(lci[3]).toMatchObject({ value: 'isento', tone: 'text-emerald-300' });
    const selic = instrumentDetailRows(byId('tesouro-selic'), 6);
    expect(selic[2].value).toMatch(/^−R\$ /);
    expect(selic[3]).toMatchObject({ label: 'IR pago (22,5%)', tone: 'text-red-300' });
  });

  it('comparativo lado a lado tem as 6 linhas do bruto ao ganho', () => {
    expect(COMPARE_ROWS.map(r => r.label)).toEqual(['Valor bruto', 'Custos', 'IR pago', 'Valor líquido', 'Rent. líquida', 'Ganho líquido']);
    expect(COMPARE_ROWS[3].cell(byId('cdb')).tone).toBe('text-white font-semibold');
  });

  it('barra do card tem mínimo visível; barra do destaque divide aporte e juro', () => {
    expect(barWidth(50, 100)).toBe('50.0%');
    expect(barWidth(1, 100)).toBe('4.0%');
    expect(barWidth(10, 0)).toBe('4.0%');
    const bar = investedVsGain({ ...best, invested: 75, netGain: 25, netValue: 100 });
    expect(bar).toEqual({ invested: '75.0%', gain: '25.0%' });
  });
});

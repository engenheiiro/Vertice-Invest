import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliar, apertar, limiteInicial, afrouxou, listarAfrouxamentos, afrouxamentosSemMotivo,
} from '../lib/catraca.mjs';
import { registrarNoHistorico, gerarTabela, substituirPlacar, INICIO, FIM } from '../lib/placar.mjs';

const MAX = { chave: 'linhasLongas', tipo: 'max', descricao: 'Linhas longas' };
const MIN = { chave: 'cobertura.x', tipo: 'min', passo: 0.5 };
const FIXO = { chave: 'foco', tipo: 'max', fixo: true, limiteFixo: 0 };
const BUNDLE = { chave: 'bundle', tipo: 'max', folga: 1.1 };
const MAPA = { chave: 'arquivosGrandes', tipo: 'mapa', padrao: 600 };
const LISTA = { chave: 'testesComData', tipo: 'lista' };

test('limite inicial é o valor de hoje (com piso, folga e regra fixa)', () => {
  assert.equal(limiteInicial(MAX, 1259), 1259);
  assert.equal(limiteInicial(MIN, 44.3), 44);
  assert.equal(limiteInicial(FIXO, 3), 0);
  assert.equal(limiteInicial(BUNDLE, 679), 747);
  assert.deepEqual(limiteInicial(MAPA, { 'a.js': 700, 'b.js': 500 }), { 'a.js': 700 });
  assert.deepEqual(limiteInicial(LISTA, ['b', 'a']), ['a', 'b']);
});

test('max: subir reprova, descer é ganho, igual passa', () => {
  assert.equal(avaliar(MAX, 10, 11).estado, 'piorou');
  assert.equal(avaliar(MAX, 10, 9).estado, 'melhorou');
  assert.equal(avaliar(MAX, 10, 10).estado, 'ok');
});

test('min com passo: ganho só conta quando o piso arredondado sobe', () => {
  assert.equal(avaliar(MIN, 44, 43.9).estado, 'piorou');
  assert.equal(avaliar(MIN, 44, 44.4).estado, 'ok');
  assert.equal(avaliar(MIN, 44, 44.5).estado, 'melhorou');
});

test('regra fixa nunca vira "ganho"', () => {
  assert.equal(avaliar(FIXO, 0, 0).estado, 'ok');
  assert.equal(avaliar(FIXO, 0, 1).estado, 'piorou');
  assert.equal(apertar(FIXO, 0, 0), 0);
});

test('bundle: a folga de 10% acompanha o aperto', () => {
  assert.equal(avaliar(BUNDLE, 747, 748).estado, 'piorou');
  assert.equal(avaliar(BUNDLE, 747, 600).estado, 'melhorou');
  assert.equal(apertar(BUNDLE, 747, 600), 660);
  assert.equal(apertar(BUNDLE, 747, 700), 747, 'medição maior que o limite/1,1 não afrouxa');
});

test('mapa: arquivo cresce acima do teto, arquivo novo passa de 600', () => {
  const limite = { 'a.js': 700 };
  assert.deepEqual(avaliar(MAPA, limite, { 'a.js': 701 }).detalhe, ['a.js: 701 > 700']);
  assert.deepEqual(avaliar(MAPA, limite, { 'a.js': 700, 'novo.js': 601 }).detalhe, ['novo.js: 601 > 600']);
  assert.equal(avaliar(MAPA, limite, { 'a.js': 650 }).estado, 'melhorou');
  assert.equal(avaliar(MAPA, limite, {}).estado, 'melhorou', 'arquivo que encolheu abaixo de 600 sai do mapa');
});

test('mapa: apertar trava o tamanho novo e solta quem ficou abaixo do padrão', () => {
  assert.deepEqual(apertar(MAPA, { 'a.js': 700, 'b.js': 900 }, { 'a.js': 650, 'b.js': 590 }), { 'a.js': 650 });
});

test('lista: item novo reprova, item que sai aperta', () => {
  assert.deepEqual(avaliar(LISTA, ['a'], ['a', 'b']).detalhe, ['b']);
  assert.equal(avaliar(LISTA, ['a', 'b'], ['a']).estado, 'melhorou');
  assert.deepEqual(apertar(LISTA, ['a', 'b'], ['a']), ['a']);
});

test('não medido nunca passa por ok', () => {
  assert.equal(avaliar(MAX, 10, null).estado, 'nao-medido');
  assert.equal(apertar(MAX, 10, null), 10);
});

test('apertar nunca afrouxa', () => {
  assert.equal(apertar(MAX, 10, 12), 10);
  assert.equal(apertar(MIN, 44, 40), 44);
});

test('afrouxamento detectado em todos os tipos', () => {
  assert.equal(afrouxou(MAX, 10, 11), true);
  assert.equal(afrouxou(MIN, 44, 43.5), true);
  assert.equal(afrouxou(MAPA, { 'a.js': 700 }, { 'a.js': 701 }), true);
  assert.equal(afrouxou(MAPA, {}, { 'novo.js': 900 }), true);
  assert.equal(afrouxou(LISTA, ['a'], ['a', 'b']), true);
  assert.equal(afrouxou(MAX, 10, undefined), true, 'apagar a métrica é afrouxar');
  assert.equal(afrouxou(MAX, undefined, 10), false, 'métrica nova não é afrouxamento');
  assert.equal(afrouxou(MAX, 10, 9), false);
});

test('afrouxamento só passa com motivo citando a chave em "## Afrouxamentos"', () => {
  const catalogo = [MAX, MIN];
  const chaves = listarAfrouxamentos(catalogo, { limites: { linhasLongas: 10, 'cobertura.x': 44 } },
    { limites: { linhasLongas: 12, 'cobertura.x': 43 } });
  assert.deepEqual(chaves, ['linhasLongas', 'cobertura.x']);
  const medicoes = '# M\n\n## Afrouxamentos\n\n- 2026-11-23 `linhasLongas`: import gerado\n\n## Notas\n`cobertura.x`';
  assert.deepEqual(afrouxamentosSemMotivo(chaves, medicoes), ['cobertura.x'], 'citar fora da seção não vale');
});

test('placar: uma coluna por data, a medição do mesmo dia é substituída', () => {
  let hist = registrarNoHistorico([], '2026-11-22', { linhasLongas: 10, testesComData: ['a', 'b'] });
  assert.equal(hist[0].valores.testesComData, 2, 'lista vira contagem no histórico');
  hist = registrarNoHistorico(hist, '2026-11-23', { linhasLongas: 9 });
  hist = registrarNoHistorico(hist, '2026-11-22', { linhasLongas: 11 });
  assert.deepEqual(hist.map((h) => h.data), ['2026-11-22', '2026-11-23']);
  assert.equal(hist[0].valores.linhasLongas, 11);
  const tabela = gerarTabela([MAX], { linhasLongas: 9 }, hist);
  assert.ok(tabela.includes('| `linhasLongas` — Linhas longas | 9 | 11 | 9 |'), tabela);
});

test('placar: troca só o trecho entre os marcadores', () => {
  const texto = `# Medições\n\nnota à mão\n\n${INICIO}\nvelho\n${FIM}\n\n## Afrouxamentos\n`;
  const novo = substituirPlacar(texto, 'NOVO');
  assert.equal(novo, `# Medições\n\nnota à mão\n\n${INICIO}\nNOVO\n${FIM}\n\n## Afrouxamentos\n`);
  assert.match(substituirPlacar('# Sem marcador', 'T'), /# Sem marcador\n\n<!-- placar:inicio/);
});

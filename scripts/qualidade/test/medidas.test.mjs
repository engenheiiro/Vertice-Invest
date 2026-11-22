// Fixtures montadas por concatenação: escritas por extenso, este arquivo seria
// contado pelas próprias réguas que testa (foco, relógio, supressão...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as md from '../lib/medidas.mjs';

const DISABLE = 'eslint-' + 'disable';
const AGORA = 'new Date' + '()';
const PULO = 'it.' + 'skip(';
const TODO = 'TO' + 'DO';

test('linhas longas: conta só o que passa de 160', () => {
  assert.equal(md.contarLinhasLongas(`${'a'.repeat(160)}\n${'b'.repeat(161)}\r\nok`), 1);
});

test('supressão sem motivo é contada; com " -- motivo" não', () => {
  const texto = [
    `// ${DISABLE}-next-line no-console`,
    `// ${DISABLE}-next-line no-console -- log de boot, roda uma vez`,
    `/* ${DISABLE} */`,
    `// ${DISABLE}-next-line prefer-rest-params -- o gtag exige arguments`,
    `// ${DISABLE}-next-line no-console -- x`,
  ].join('\n');
  assert.deepEqual(md.contarSupressoes(texto), { eslintDisable: 5, eslintDisableSemMotivo: 3, tsDiretivas: 0 });
});

test('diretivas do TypeScript contam à parte', () => {
  assert.equal(md.contarSupressoes(`// @ts-${'ignore'}\nconst a = 1;`).tsDiretivas, 1);
});

test('"as any" conta só a expressão, não a palavra solta', () => {
  assert.equal(md.contarAsAny(`const x = y as ${'any'};\n// has anything`), 1);
});

test('não-nulo vem da árvore de sintaxe: "!=" e "!x" não contam', () => {
  const ts = 'const a = b!.c; const d = e!; if (f != g && !h) {}';
  assert.equal(md.contarNaoNulo(ts, 'x.ts'), 2);
  assert.equal(md.contarNaoNulo('const el = <div>{a!.b}</div>;', 'x.tsx'), 1);
});

test('foco em teste: .only e fit acusam; FitText não', () => {
  assert.equal(md.temFoco(`describe.${'only'}('x', () => {})`), true);
  assert.equal(md.temFoco(`f${'it'}('x', () => {})`), true);
  assert.equal(md.temFoco('const FitText = () => null;'), false);
});

test('teste com data: relógio solto acusa; relógio fixo absolve', () => {
  assert.equal(md.dependeDaData(`const hoje = ${AGORA};`), true);
  assert.equal(md.dependeDaData(`vi.useFakeTimers(); const hoje = ${AGORA};`), false);
  assert.equal(md.dependeDaData('const d = new Date("2026-01-02");'), false);
});

test('quarentena: exige data, no máximo 7 dias à frente e não vencida', () => {
  const hoje = '2026-11-22';
  const ok = `// QUARENTENA até 2026-11-29\n${PULO}'x', () => {});`;
  assert.deepEqual(md.analisarQuarentena(ok, hoje), { total: 1, irregulares: [] });
  const casos = [
    [`${PULO}'x')`, 'sem'],
    [`${PULO}'x') // QUARENTENA até 2026-11-21`, 'venceu'],
    [`${PULO}'x') // QUARENTENA até 2026-11-30`, 'passa de 7 dias'],
  ];
  for (const [texto, problema] of casos) {
    const r = md.analisarQuarentena(texto, hoje);
    assert.equal(r.irregulares.length, 1, texto);
    assert.match(r.irregulares[0].problema, new RegExp(problema));
  }
});

test('marcador de pendência precisa de (dono, data); "todo" português não conta', () => {
  const texto = [
    `// ${TODO}: revisar`,
    `// ${TODO}(matheus, 2026-11-22): revisar`,
    `// recalcula ${TODO} o histórico`,
    `const s = '${TODO}';`,
  ].join('\n');
  assert.equal(md.contarMarcadoresSemDono(texto), 1);
});

test('img sem srcSet', () => {
  const tsx = '<img src="a.png" alt="" />\n<img\n  src="b.png"\n  srcSet="b@2x.png 2x"\n/>';
  assert.equal(md.contarImgSemSrcset(tsx), 1);
});

test('classes do CSS: ignora url(), strings, comentários e @media', () => {
  const css = '/* .fantasma {} */ .a, .b:hover { background: url(x.woff2) } '
    + '@media (min-width: 1px) { .c { content: ".d" } }';
  assert.deepEqual(md.classesDoCss(css), ['a', 'b', 'c']);
});

test('classes sem uso: palavra inteira, prefixo de biblioteca é ignorado', () => {
  const corpus = 'className="a text-sky-500-x"';
  assert.deepEqual(md.classesSemUso(['a', 'text-sky-500', 'recharts-sector'], corpus), ['text-sky-500']);
});

test('piso de cobertura arredonda para baixo em 0,5', () => {
  assert.equal(md.pisoMeio(96.1), 96);
  assert.equal(md.pisoMeio(93.6), 93.5);
  assert.equal(md.pisoMeio(44.3), 44);
  assert.equal(md.pisoMeio(82.5), 82.5);
});

test('área é o prefixo mais longo que casa', () => {
  const areas = ['services', 'services/engines', 'utils'];
  assert.equal(md.areaDe('services/engines/a.js', areas), 'services/engines');
  assert.equal(md.areaDe('services/b.js', areas), 'services');
  assert.equal(md.areaDe('servicesX/b.js', areas), null);
});

test('cobertura por área soma linhas, não faz média de porcentagens', () => {
  const resumo = {
    total: {},
    '/r/utils/a.js': { lines: { covered: 9, total: 10 } },
    '/r/utils/b.js': { lines: { covered: 0, total: 90 } },
  };
  const r = md.coberturaPorArea(resumo, (p) => p.replace('/r/', ''), ['utils', 'models']);
  assert.deepEqual(r, { utils: 9, models: null });
});

test('resumo do lint separa erros, avisos, a11y e complexidade', () => {
  const resultados = [{
    filePath: '/r/a.js',
    messages: [
      { severity: 2, ruleId: 'no-undef' },
      { severity: 1, ruleId: 'no-unused-vars' },
      { severity: 1, ruleId: 'jsx-a11y/alt-text' },
      { severity: 1, ruleId: 'complexity', message: 'Function has a complexity of 31. Maximum allowed is 15.' },
      { severity: 1, ruleId: 'complexity', message: 'Arrow function has a complexity of 18. Maximum allowed is 15.' },
    ],
  }];
  const r = md.resumirLint(resultados, (p) => p.replace('/r/', ''));
  assert.deepEqual(r, { erros: 1, avisos: 1, a11y: 1, complexidade: { 'a.js': 2 }, complexidadeMax: 31 });
});

test('major atrás: só conta quem está MAIS de uma versão maior atrás', () => {
  const outdated = { a: { current: '1.2.0', latest: '3.0.0' }, b: { current: '4.0.0', latest: '5.1.0' }, c: { latest: '2.0.0' } };
  assert.equal(md.contarMajorAtras(outdated), 2);
});

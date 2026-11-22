import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encontrarCodigoMorto, dependenciasSemUso } from '../lib/codigoMorto.mjs';
import { encontrarSegredos, ignorarNaVarredura } from '../lib/segredos.mjs';

const ehTeste = (f) => f.includes('/tests/');

test('código morto: arquivo sem import, export sem uso e export só de teste', () => {
  const corpus = [
    { caminho: 'server/index.js', texto: "import { usado } from './utils/a.js';" },
    {
      caminho: 'server/utils/a.js',
      texto: 'export function usado() {}\nexport const morto = 1;\nexport function soTeste() {}\nexport function __reset() {}',
    },
    { caminho: 'server/utils/orfao.js', texto: 'export const x = 1;' },
    { caminho: 'server/tests/a.spec.js', texto: "import { soTeste, __reset } from '../utils/a.js';" },
  ];
  const fontes = corpus.filter((c) => !ehTeste(c.caminho));
  const r = encontrarCodigoMorto(corpus, fontes, { ehTeste, entradas: new Set(['server/index.js']) });
  assert.deepEqual(r, [
    'server/utils/a.js:morto',
    'server/utils/a.js:soTeste (só teste)',
    'server/utils/orfao.js (arquivo sem import)',
  ]);
});

test('barrel index.ts importado pela pasta não é arquivo morto', () => {
  const corpus = [
    { caminho: 'client/src/pages/Dashboard.tsx', texto: "import { Card } from '../components/ui';" },
    { caminho: 'client/src/components/ui/index.ts', texto: "export { Card } from './Card';" },
  ];
  const r = encontrarCodigoMorto(corpus, [corpus[1]], { ehTeste, entradas: new Set() });
  assert.deepEqual(r, []);
});

test('export usado dentro do próprio arquivo não é morto', () => {
  const corpus = [
    { caminho: 'server/index.js', texto: "import { b } from './m.js';" },
    { caminho: 'server/m.js', texto: 'export const LIMITE = 3;\nexport function b() { return LIMITE; }' },
  ];
  const r = encontrarCodigoMorto(corpus, [corpus[1]], { ehTeste, entradas: new Set() });
  assert.deepEqual(r, []);
});

test('dependência sem uso: import, citação em config e script contam como uso', () => {
  const pkg = { dependencies: { axios: '1', vite: '1', autoprefixer: '1', lodash: '1', typescript: '5' }, scripts: { dev: 'vite' } };
  const textos = ["import axios from 'axios';", 'export default { plugins: { autoprefixer: {} } }'];
  assert.deepEqual(dependenciasSemUso(pkg, textos, ['typescript']), ['lodash']);
});

test('segredos: reconhece formato de credencial, ignora placeholder', () => {
  const chaveAws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const uriComSenha = 'mongodb+srv://' + 'app:s3nhaForte@cluster0.x.mongodb.net/db';
  const placeholder = 'mongodb+srv://' + '<usuario>:<senha>@cluster0.mongodb.net';
  const texto = [`const k = '${chaveAws}';`, `MONGO=${uriComSenha}`, `MONGO=${placeholder}`].join('\n');
  assert.deepEqual(encontrarSegredos(texto).map((a) => a.linha), [1, 2]);
});

test('lockfile e binário ficam fora da varredura', () => {
  assert.equal(ignorarNaVarredura('server/package-lock.json'), true);
  assert.equal(ignorarNaVarredura('client/public/og.png'), true);
  assert.equal(ignorarNaVarredura('server/app.js'), false);
});

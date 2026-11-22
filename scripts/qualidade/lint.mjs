#!/usr/bin/env node
/**
 * Lint do check: o ESLint do projeto + a regra de complexidade (teto 15) só
 * no código de produção, numa passada só. Imprime os erros, grava o resumo em
 * .qualidade/lint.json para a catraca e sai com 1 se houver erro.
 *
 * A complexidade entra aqui e não no eslint.config.js de propósito: lá ela
 * despejaria 200+ avisos em todo `npm run lint` e no editor; aqui ela é só um
 * número que a catraca impede de subir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { resumirLint } from './lib/medidas.mjs';
import { RAIZ, PASTA_ARTEFATOS } from './lib/coleta.mjs';

const PRODUCAO = ['server/**/*.js', 'client/src/**/*.{ts,tsx}', 'scripts/qualidade/**/*.mjs'];
const FORA = ['server/tests/**', 'server/scripts/**', '**/*.{test,spec}.*', 'client/src/stories/**', 'scripts/qualidade/test/**'];

const eslint = new ESLint({
  cwd: RAIZ,
  overrideConfig: [{ files: PRODUCAO, ignores: FORA, rules: { complexity: ['warn', 15] } }],
});

const resultados = await eslint.lintFiles(['.']);
const relativo = (abs) => path.relative(RAIZ, abs).split(path.sep).join('/');
const resumo = resumirLint(resultados, relativo);

fs.mkdirSync(PASTA_ARTEFATOS, { recursive: true });
fs.writeFileSync(path.join(PASTA_ARTEFATOS, 'lint.json'), `${JSON.stringify(resumo, null, 2)}\n`);

const comErro = ESLint.getErrorResults(resultados);
if (comErro.length) console.log((await eslint.loadFormatter('stylish')).format(comErro));
const funcoes = Object.values(resumo.complexidade).reduce((a, b) => a + b, 0);
console.log(`ESLint: ${resumo.erros} erro(s), ${resumo.avisos} aviso(s), ${resumo.a11y} de a11y, `
  + `${funcoes} função(ões) com complexidade > 15 (máx. ${resumo.complexidadeMax}).`);
process.exit(resumo.erros > 0 ? 1 : 0);

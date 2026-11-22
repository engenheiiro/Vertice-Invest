#!/usr/bin/env node
/**
 * O portão.
 *
 *   npm run check            completo: antes de publicar (push na main = deploy)
 *   npm run check:rapido     tipos, lint, testes com cobertura e catraca (pre-push)
 *   npm run check -- --sem-e2e   completo sem Playwright (o CI roda o e2e em job próprio)
 *
 * Roda TODAS as etapas mesmo depois de uma falha — o objetivo é ver o placar
 * inteiro — e sai com 1 se qualquer uma falhar ou se o total passar de 8 min.
 * A saída de cada etapa vai para .qualidade/logs/<etapa>.log; na falha, o fim
 * do log aparece no terminal.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PASTA_ARTEFATOS } from './lib/coleta.mjs';

const TETO_TOTAL_S = 8 * 60;
const IGNORAR_JSCPD = '**/node_modules/**,**/tests/**,server/scripts/**,**/*.test.*,**/*.spec.*,**/stories/**,**/coverage/**';
const VITEST = (parte) => 'npx vitest run --coverage --reporter=dot --reporter=json '
  + `--outputFile.json=../.qualidade/testes-${parte}.json`;

const ETAPAS = {
  tipos: { cmd: 'npx tsc --noEmit', cwd: 'client' },
  lint: { cmd: 'node scripts/qualidade/lint.mjs', mostrar: 1 },
  build: { cmd: 'npm run build', cwd: 'client' },
  'testes:server': { cmd: VITEST('server'), cwd: 'server' },
  'testes:client': { cmd: VITEST('client'), cwd: 'client' },
  'testes:scripts': { cmd: 'node --test "scripts/qualidade/test/*.test.mjs"' },
  duplicacao: { cmd: `npx jscpd server client/src scripts -k 70 -i "${IGNORAR_JSCPD}" -r json -o .qualidade/jscpd` },
  dependencias: { cmd: 'node scripts/qualidade/dependencias.mjs', mostrar: 3 },
  e2e: { cmd: 'npx playwright test --reporter=line', cwd: 'client' },
};

function lerArgs(argv) {
  return { rapido: argv.includes('--rapido'), semE2e: argv.includes('--sem-e2e') };
}

function etapasDoModo({ rapido, semE2e }) {
  if (rapido) {
    const precisaBuild = !fs.existsSync(path.join(RAIZ, 'client/dist/index.html'));
    return ['tipos', 'lint', ...(precisaBuild ? ['build'] : []), 'testes:server', 'testes:client', 'testes:scripts'];
  }
  const todas = ['tipos', 'lint', 'build', 'testes:server', 'testes:client', 'testes:scripts', 'duplicacao', 'dependencias', 'e2e'];
  return semE2e ? todas.filter((e) => e !== 'e2e') : todas;
}

/** Limpa os artefatos da rodada anterior; o último resultado do portão fica. */
function limparArtefatos() {
  fs.mkdirSync(path.join(PASTA_ARTEFATOS, 'logs'), { recursive: true });
  for (const nome of fs.readdirSync(PASTA_ARTEFATOS)) {
    if (nome === 'ultimo-check.json' || nome === 'logs') continue;
    fs.rmSync(path.join(PASTA_ARTEFATOS, nome), { recursive: true, force: true });
  }
}

function rodar(nome, { cmd, cwd = '.', mostrar = 0 }) {
  process.stdout.write(`▶ ${nome.padEnd(16)}`);
  const inicio = Date.now();
  const r = spawnSync(cmd, { cwd: path.join(RAIZ, cwd), shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const segundos = Math.round((Date.now() - inicio) / 100) / 10;
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(path.join(PASTA_ARTEFATOS, 'logs', `${nome.replace(':', '-')}.log`), saida);
  const ok = r.status === 0;
  console.log(`${ok ? '✔' : '✘'} ${segundos.toFixed(1).padStart(6)} s`);
  const linhas = saida.trimEnd().split(/\r?\n/);
  const trecho = ok ? linhas.slice(-mostrar) : linhas.slice(-40);
  if (trecho.length && (mostrar || !ok)) console.log(trecho.map((l) => `    ${l}`).join('\n'));
  return { nome, ok, segundos };
}

function rodarCatraca(rodada, rapido) {
  console.log('▶ catraca');
  const inicio = Date.now();
  const flags = [`--rodada=${rodada}`, rapido ? '--rapido' : '--estrito'];
  const r = spawnSync('node', ['scripts/qualidade/metricas.mjs', ...flags], { cwd: RAIZ, stdio: 'inherit' });
  return { nome: 'catraca', ok: r.status === 0, segundos: Math.round((Date.now() - inicio) / 100) / 10 };
}

function headAtual() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim(); } catch { return null; }
}

function imprimirResumo(resultados, total) {
  console.log('\nEtapa              Tempo');
  for (const r of resultados) console.log(`${r.ok ? '✔' : '✘'} ${r.nome.padEnd(16)} ${r.segundos.toFixed(1).padStart(6)} s`);
  const estourou = total > TETO_TOTAL_S;
  console.log(`${estourou ? '✘' : '✔'} total            ${total.toFixed(1).padStart(6)} s (teto ${TETO_TOTAL_S} s)`);
  return estourou;
}

function main() {
  const args = lerArgs(process.argv.slice(2));
  const modo = args.rapido ? 'rapido' : 'completo';
  const rodada = Date.now() - 1000;
  limparArtefatos();
  console.log(`Portão (${modo}${args.semE2e ? ', sem e2e' : ''})\n`);

  const resultados = [];
  const tempos = {};
  for (const nome of etapasDoModo(args)) {
    const r = rodar(nome, ETAPAS[nome]);
    resultados.push(r);
    tempos[nome] = r.segundos;
    fs.writeFileSync(path.join(PASTA_ARTEFATOS, 'tempos.json'), `${JSON.stringify(tempos, null, 2)}\n`);
  }
  resultados.push(rodarCatraca(rodada, args.rapido));

  const total = Math.round((Date.now() - rodada) / 100) / 10;
  const estourou = imprimirResumo(resultados, total);
  const ok = resultados.every((r) => r.ok) && !estourou;
  const registro = { modo, semE2e: args.semE2e, ok, head: headAtual(), quando: new Date().toISOString(), total, etapas: resultados };
  fs.writeFileSync(path.join(PASTA_ARTEFATOS, 'ultimo-check.json'), `${JSON.stringify(registro, null, 2)}\n`);
  console.log(ok ? '\n✔ Portão verde.' : '\n✘ Portão vermelho: consertar vem antes de qualquer coisa nova.');
  process.exit(ok ? 0 : 1);
}

main();

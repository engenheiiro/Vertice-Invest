#!/usr/bin/env node
/**
 * Fechamento de sessão: confere os itens do CLAUDE.md e mostra ✔/✘ para cada
 * um. É um relatório, não o portão — mas sai com 1 se algum item falhar, para
 * ninguém fechar a sessão achando que está tudo em ordem.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, PASTA_ARTEFATOS } from './lib/coleta.mjs';

const RAMO_PRINCIPAL = 'main';

function git(args) {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}
const linhas = (txt) => (txt ? txt.split('\n').map((l) => l.trim()).filter(Boolean) : []);
const lerJson = (nome) => {
  const arq = path.join(PASTA_ARTEFATOS, nome);
  return fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : null;
};

const item = (ok, titulo, detalhes = []) => ({ ok, titulo, detalhes });

function tudoEmCommit() {
  const pendentes = linhas(git(['status', '--porcelain']));
  return item(pendentes.length === 0, 'Tudo em commit', pendentes);
}

function ramoCerto() {
  const ramo = git(['branch', '--show-current']);
  const upstream = git(['rev-parse', '--abbrev-ref', '@{u}']);
  if (!ramo) return item(false, 'Ramo certo', ['HEAD destacado: crie ou troque de ramo antes de commitar']);
  return item(Boolean(upstream), `Ramo certo: ${ramo}${upstream ? ` → ${upstream}` : ''}`,
    upstream ? [] : ['ramo sem upstream (git push -u origin <ramo>, com aprovação)']);
}

function ramosLimpos() {
  const atual = git(['branch', '--show-current']);
  const mesclados = linhas(git(['branch', '--merged', RAMO_PRINCIPAL, '--format=%(refname:short)']))
    .filter((b) => b !== RAMO_PRINCIPAL && b !== atual);
  const worktrees = linhas(git(['worktree', 'list'])).slice(1);
  const amostra = `${mesclados.slice(0, 5).join(' ')}${mesclados.length > 5 ? ' …' : ''}`;
  const detalhes = [
    ...(mesclados.length ? [`${mesclados.length} ramo(s) já mesclado(s): git branch -d ${amostra}`] : []),
    ...worktrees.map((w) => `worktree parado: ${w}`),
  ];
  return item(detalhes.length === 0, 'Ramos mesclados apagados e sem worktree parado', detalhes);
}

function catracaEmDia(catraca) {
  if (!catraca) return item(false, 'Catraca em dia', ['sem medição: rode npm run check']);
  const detalhes = [
    ...catraca.piorou.map((c) => `piorou: ${c}`),
    ...(catraca.melhorou.length ? [`ganhos não travados (${catraca.melhorou.join(', ')}): npm run metricas -- --apertar`] : []),
  ];
  return item(detalhes.length === 0, `Catraca em dia (medida em ${catraca.data})`, detalhes);
}

function quarentenaZerada(catraca) {
  const n = catraca?.quarentena ?? null;
  return item(n === 0, 'Quarentena zerada', n ? [`${n} teste(s) pulado(s): corrigir ou apagar em até 7 dias`] : []);
}

function portaoVerde() {
  const ultimo = lerJson('ultimo-check.json');
  const head = git(['rev-parse', 'HEAD']);
  if (!ultimo) return item(false, 'Portão verde', ['nenhum check rodado: npm run check']);
  const detalhes = [];
  if (!ultimo.ok) detalhes.push(`último check (${ultimo.modo}) vermelho — conserte ou escreva o motivo em docs/PENDENCIAS.md`);
  if (ultimo.head !== head) detalhes.push('último check é de outro commit: rode npm run check de novo');
  return item(detalhes.length === 0, `Portão verde (${ultimo.modo}, ${ultimo.total} s)`, detalhes);
}

function faltaPublicar() {
  const commits = linhas(git(['log', '@{u}..HEAD', '--oneline']));
  return item(commits.length === 0, 'Nada pendente de publicação',
    commits.length ? [`${commits.length} commit(s) só local — publicar precisa da aprovação do dono:`, ...commits] : []);
}

function docsEmDia() {
  const mudados = linhas(git(['diff', '--name-only', '@{u}']));
  const detalhes = [];
  if (mudados.includes('docs/metricas.json') && !mudados.includes('docs/medicoes.md')) {
    detalhes.push('docs/metricas.json mudou sem docs/medicoes.md (npm run metricas -- --registrar)');
  }
  if (!fs.existsSync(path.join(RAIZ, 'docs/PENDENCIAS.md'))) detalhes.push('docs/PENDENCIAS.md não existe');
  return item(detalhes.length === 0, 'Docs atualizados e pendências em docs/PENDENCIAS.md', detalhes);
}

function main() {
  const catraca = lerJson('catraca.json');
  const itens = [
    tudoEmCommit(), ramoCerto(), ramosLimpos(), catracaEmDia(catraca), quarentenaZerada(catraca),
    portaoVerde(), faltaPublicar(), docsEmDia(),
  ];
  console.log('Fechamento de sessão\n');
  for (const i of itens) {
    console.log(`${i.ok ? '✔' : '✘'} ${i.titulo}`);
    for (const d of i.detalhes.slice(0, 12)) console.log(`    ${d}`);
  }
  const falhas = itens.filter((i) => !i.ok).length;
  console.log(falhas ? `\n✘ ${falhas} item(ns) em aberto.` : '\n✔ Sessão pode fechar.');
  process.exit(falhas ? 1 : 0);
}

main();

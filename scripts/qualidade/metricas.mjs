#!/usr/bin/env node
/**
 * Catraca de métricas: mede, compara com docs/metricas.json e reprova se algo
 * piorou.
 *
 *   npm run metricas                       placar com os artefatos que existirem
 *   npm run metricas -- --apertar          trava os ganhos (limites só apertam)
 *   npm run metricas -- --registrar        grava a medição do dia em docs/medicoes.md
 *   npm run metricas -- --inicializar      cria a base com os valores de hoje
 *
 * Usado pelo check: --rodada=<ms> (ignora artefato mais velho que a rodada),
 * --rapido (pula métricas só do check completo) e --estrito (não medido reprova).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOGO } from './lib/catalogo.mjs';
import {
  avaliar, apertar, limiteInicial, listarAfrouxamentos, afrouxamentosSemMotivo, resumirValor,
} from './lib/catraca.mjs';
import { coletarTudo, RAIZ, PASTA_ARTEFATOS } from './lib/coleta.mjs';
import { registrarNoHistorico, gerarTabela, substituirPlacar } from './lib/placar.mjs';

const ARQ_BASE = path.join(RAIZ, 'docs/metricas.json');
const ARQ_MEDICOES = path.join(RAIZ, 'docs/medicoes.md');
const SIMBOLO = { ok: '✔', melhorou: '▲', piorou: '✘', 'nao-medido': '·', pulado: ' ' };

function hojeEmBrasilia(agora = new Date()) {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function lerArgs(argv) {
  const rodada = argv.find((a) => a.startsWith('--rodada='));
  return {
    apertar: argv.includes('--apertar'),
    registrar: argv.includes('--registrar') || argv.includes('--apertar'),
    inicializar: argv.includes('--inicializar'),
    rapido: argv.includes('--rapido'),
    estrito: argv.includes('--estrito') || argv.includes('--rapido'),
    rodada: rodada ? Number(rodada.split('=')[1]) : null,
    // O runner do CI é ~2× mais lento que a máquina de desenvolvimento (suíte do
    // server: 67 s lá, 29 s aqui). O teto de 1 min é do ciclo local; no CI o
    // tempo não é julgado, senão o portão reprovaria o hardware, não o código.
    semTempo: process.env.CI === 'true',
  };
}

function lerBase() {
  if (!fs.existsSync(ARQ_BASE)) return null;
  return JSON.parse(fs.readFileSync(ARQ_BASE, 'utf8'));
}

function gravarJson(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `${JSON.stringify(dados, null, 2)}\n`);
}

/** Base da última versão publicada (upstream), para detectar afrouxamento. */
function baseAnterior() {
  for (const ref of ['@{u}', 'HEAD']) {
    try {
      const txt = execFileSync('git', ['show', `${ref}:docs/metricas.json`], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { ref, base: JSON.parse(txt) };
    } catch { /* ref inexistente ou arquivo ainda não publicado: tenta a próxima */ }
  }
  return null;
}

function julgar(base, valores, args) {
  return CATALOGO.map((def) => {
    if (args.rapido && def.modo === 'completo') return { def, estado: 'pulado' };
    if (args.semTempo && def.chave.startsWith('tempo.')) return { def, estado: 'pulado' };
    const limite = base.limites[def.chave];
    const valor = valores[def.chave];
    if (limite === undefined && def.tipo !== 'info') return { def, valor, estado: 'piorou', detalhe: ['sem limite na base: rode --apertar'] };
    return { def, valor, limite, ...avaliar(def, limite, valor) };
  });
}

function imprimir(linhas) {
  for (const l of linhas) {
    if (l.estado === 'pulado') continue;
    const hoje = resumirValor(l.valor);
    const lim = l.def.tipo === 'info' ? '' : ` (limite ${resumirValor(l.limite)})`;
    console.log(`${SIMBOLO[l.estado]} ${l.def.chave.padEnd(34)} ${String(hoje ?? '—').padStart(8)}${lim}`);
    for (const d of (l.estado === 'ok' ? [] : l.detalhe || []).slice(0, 10)) console.log(`      ${d}`);
  }
}

function verificarAfrouxamentos(base) {
  const anterior = baseAnterior();
  if (!anterior) return [];
  const chaves = listarAfrouxamentos(CATALOGO, anterior.base, base);
  const medicoes = fs.existsSync(ARQ_MEDICOES) ? fs.readFileSync(ARQ_MEDICOES, 'utf8') : '';
  return afrouxamentosSemMotivo(chaves, medicoes).map((c) => `${c} afrouxou desde ${anterior.ref} sem motivo em docs/medicoes.md (## Afrouxamentos)`);
}

function registrar(base, valores, hoje) {
  base.historico = registrarNoHistorico(base.historico || [], hoje, valores);
  base.atualizadoEm = hoje;
  const medicoes = fs.existsSync(ARQ_MEDICOES) ? fs.readFileSync(ARQ_MEDICOES, 'utf8') : '# Medições\n';
  fs.writeFileSync(ARQ_MEDICOES, substituirPlacar(medicoes, gerarTabela(CATALOGO, base.limites, base.historico)));
}

function inicializar(valores, hoje) {
  const faltando = CATALOGO.filter((d) => d.tipo !== 'info' && (valores[d.chave] ?? null) === null).map((d) => d.chave);
  if (faltando.length) {
    console.error(`✘ Sem medição para: ${faltando.join(', ')}. Rode "npm run check" antes de --inicializar.`);
    process.exit(1);
  }
  const limites = Object.fromEntries(CATALOGO.map((d) => [d.chave, limiteInicial(d, valores[d.chave])]));
  return { versao: 1, criadoEm: hoje, atualizadoEm: hoje, limites, historico: [] };
}

function travarGanhos(base, valores) {
  for (const def of CATALOGO) {
    const atual = base.limites[def.chave];
    const valor = valores[def.chave] ?? null;
    if (atual === undefined) { if (valor !== null) base.limites[def.chave] = limiteInicial(def, valor); continue; }
    base.limites[def.chave] = apertar(def, atual, valor);
  }
}

function resumoDaRodada(linhas, hoje, quarentena) {
  const de = (estado) => linhas.filter((l) => l.estado === estado).map((l) => l.def.chave);
  const valores = Object.fromEntries(linhas.map((l) => [l.def.chave, resumirValor(l.valor)]));
  return { data: hoje, piorou: de('piorou'), melhorou: de('melhorou'), naoMedido: de('nao-medido'), valores, quarentena };
}

function main() {
  const args = lerArgs(process.argv.slice(2));
  const hoje = hojeEmBrasilia();
  const { valores, detalhes } = coletarTudo({ rodada: args.rodada, hoje });

  if (args.inicializar && lerBase()) {
    console.error('✘ docs/metricas.json já existe. Para travar ganhos use --apertar.');
    process.exit(1);
  }
  const base = args.inicializar ? inicializar(valores, hoje) : lerBase();
  if (!base) { console.error('✘ docs/metricas.json não existe. Rode --inicializar.'); process.exit(1); }

  if (args.apertar) travarGanhos(base, valores);
  const linhas = julgar(base, valores, args);
  imprimir(linhas);
  for (const d of detalhes.quarentena) console.log(`      quarentena: ${d}`);

  const erros = linhas.filter((l) => l.estado === 'piorou').map((l) => `${l.def.chave} piorou`);
  if (args.estrito) erros.push(...linhas.filter((l) => l.estado === 'nao-medido').map((l) => `${l.def.chave} não foi medido nesta rodada`));
  erros.push(...verificarAfrouxamentos(base));

  if (args.registrar || args.inicializar) { registrar(base, valores, hoje); gravarJson(ARQ_BASE, base); }
  gravarJson(path.join(PASTA_ARTEFATOS, 'catraca.json'), resumoDaRodada(linhas, hoje, valores.testesEmQuarentena));

  const ganhos = linhas.filter((l) => l.estado === 'melhorou').length;
  if (ganhos && !args.apertar) console.log(`\n▲ ${ganhos} ganho(s) não travado(s): rode "npm run metricas -- --apertar".`);
  if (erros.length) {
    console.error(`\n✘ Catraca reprovou:\n  - ${erros.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\n✔ Catraca: nada piorou.');
}

main();

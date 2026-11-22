/**
 * Coleta: lê o repositório e os artefatos da rodada (.qualidade/, coverage,
 * dist) e devolve { chave: valor } para cada métrica do catálogo.
 *
 * Artefato de outra rodada não vale: com `rodada` (instante em que o check
 * começou), arquivo mais velho que ela é tratado como "não medido" — senão uma
 * cobertura de ontem aprovaria o código de hoje.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as md from './medidas.mjs';
import { encontrarCodigoMorto, dependenciasSemUso } from './codigoMorto.mjs';
import { encontrarSegredos, ignorarNaVarredura } from './segredos.mjs';
import { AREAS_CLIENT, AREAS_SERVER } from './catalogo.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PASTA_ARTEFATOS = path.join(RAIZ, '.qualidade');

const ESCOPO = ['server/', 'client/src/', 'client/e2e/', 'scripts/'];
const FORA_DO_CODIGO_VIVO = /^(\.backups|\.claude|design-prototypes|tmp|backup_[^/]*)\//;
const RE_CODIGO = /\.(js|jsx|ts|tsx|mjs|cjs)$/;
const ENTRADAS = new Set(['server/index.js', 'server/app.js', 'server/instrument.js', 'client/src/index.tsx', 'client/src/prerender.tsx']);

export const ehTeste = (f) => /\.(spec|test)\.|(^|\/)(tests|test|e2e)\//.test(f);
const ehTs = (f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/** Versionados + novos ainda não commitados (respeitando o .gitignore). */
export function listarArquivos() {
  const saida = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8' });
  return saida.split('\n').filter((f) => f && fs.existsSync(path.join(RAIZ, f)));
}

function lerArtefato(rel, rodada) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) return null;
  if (rodada && fs.statSync(abs).mtimeMs < rodada) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

// ─── Código-fonte ──────────────────────────────────────────────────────────

function novoAcumulador() {
  return {
    arquivosGrandes: {}, linhasLongas: 0, eslintDisable: 0, eslintDisableSemMotivo: 0, tsDiretivas: 0,
    asAny: 0, naoNulo: 0, focoEmTeste: 0, testesComData: [], testesEmQuarentena: 0, quarentenaIrregular: 0,
    marcadoresSemDono: 0, imgSemSrcset: 0, detalhesQuarentena: [],
  };
}

function medirTeste(acc, f, texto, hoje) {
  if (md.temFoco(texto)) acc.focoEmTeste++;
  if (md.dependeDaData(texto)) acc.testesComData.push(f);
  const q = md.analisarQuarentena(texto, hoje);
  acc.testesEmQuarentena += q.total;
  acc.quarentenaIrregular += q.irregulares.length;
  acc.detalhesQuarentena.push(...q.irregulares.map((i) => `${f}:${i.linha} ${i.problema}`));
}

function medirTs(acc, f, texto) {
  acc.asAny += md.contarAsAny(texto);
  acc.naoNulo += md.contarNaoNulo(texto, f);
  if (f.startsWith('client/src/') && f.endsWith('.tsx') && !ehTeste(f)) acc.imgSemSrcset += md.contarImgSemSrcset(texto);
}

function medirArquivo(acc, f, texto, hoje) {
  const linhas = texto.split(/\r?\n/).length;
  if (linhas > 600) acc.arquivosGrandes[f] = linhas;
  acc.linhasLongas += md.contarLinhasLongas(texto);
  const s = md.contarSupressoes(texto);
  acc.eslintDisable += s.eslintDisable;
  acc.eslintDisableSemMotivo += s.eslintDisableSemMotivo;
  acc.tsDiretivas += s.tsDiretivas;
  acc.marcadoresSemDono += md.contarMarcadoresSemDono(texto);
  if (ehTs(f)) medirTs(acc, f, texto);
  if (ehTeste(f)) medirTeste(acc, f, texto, hoje);
}

export function coletarCodigo(arquivos, hoje) {
  const acc = novoAcumulador();
  for (const f of arquivos) {
    if (!ESCOPO.some((e) => f.startsWith(e)) || !RE_CODIGO.test(f)) continue;
    medirArquivo(acc, f, ler(f), hoje);
  }
  acc.testesComData.sort();
  return acc;
}

// ─── CSS, bundle, código morto, dependências, segredos, strict ─────────────

export function coletarCssSemUso(arquivos) {
  const css = path.join(RAIZ, 'client/src/index.css');
  if (!fs.existsSync(css)) return [];
  const corpus = arquivos
    .filter((f) => (f.startsWith('client/src/') && /\.tsx?$/.test(f)) || f === 'client/index.html')
    .map(ler).join('\n');
  return md.classesSemUso(md.classesDoCss(fs.readFileSync(css, 'utf8')), corpus);
}

function somarBundle(pasta) {
  let total = 0;
  for (const nome of fs.readdirSync(pasta)) {
    const abs = path.join(pasta, nome);
    if (fs.statSync(abs).isDirectory()) total += somarBundle(abs);
    else if (/\.(js|css)$/.test(nome) && !/^(sw|workbox-)/.test(nome)) total += zlib.gzipSync(fs.readFileSync(abs)).length;
  }
  return total;
}

export function coletarBundle(rodada) {
  const indice = path.join(RAIZ, 'client/dist/index.html');
  if (!fs.existsSync(indice) || (rodada && fs.statSync(indice).mtimeMs < rodada)) return null;
  return Math.round(somarBundle(path.join(RAIZ, 'client/dist')) / 1024);
}

export function coletarCodigoMorto(arquivos) {
  const vivos = arquivos.filter((f) => RE_CODIGO.test(f) && !FORA_DO_CODIGO_VIVO.test(f));
  const corpus = vivos.map((caminho) => ({ caminho, texto: ler(caminho) }));
  const ehFonte = (f) => (f.startsWith('server/') || f.startsWith('client/src/'))
    && !ehTeste(f) && !/^server\/scripts\/|\/stories\/|\.stories\.|\.d\.ts$|config\./.test(f);
  return encontrarCodigoMorto(corpus, corpus.filter((c) => ehFonte(c.caminho)), { ehTeste, entradas: ENTRADAS });
}

const IMPLICITAS = { client: ['typescript', 'postcss'], server: [] };

export function coletarDepsSemUso(arquivos) {
  let total = 0;
  for (const parte of ['server', 'client']) {
    const pkg = JSON.parse(ler(`${parte}/package.json`));
    const textos = arquivos
      .filter((f) => f.startsWith(`${parte}/`) && (RE_CODIGO.test(f) || /\.html$/.test(f)))
      .map(ler);
    total += dependenciasSemUso(pkg, textos, IMPLICITAS[parte]).length;
  }
  return total;
}

export function coletarSegredos(arquivos) {
  let total = 0;
  for (const f of arquivos) {
    if (ignorarNaVarredura(f) || FORA_DO_CODIGO_VIVO.test(f)) continue;
    const abs = path.join(RAIZ, f);
    if (fs.statSync(abs).size > 2_000_000) continue;
    total += encontrarSegredos(fs.readFileSync(abs, 'utf8')).length;
  }
  return total;
}

export function coletarForaStrict(arquivos) {
  const bruto = ler('client/tsconfig.json').replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  if (JSON.parse(bruto).compilerOptions?.strict === true) return 0;
  return arquivos.filter((f) => f.startsWith('client/src/') && ehTs(f)).length;
}

// ─── Artefatos da rodada ────────────────────────────────────────────────────

function relativoA(parte) {
  return (abs) => path.relative(path.join(RAIZ, parte), abs).split(path.sep).join('/');
}

export function coletarCobertura(rodada) {
  const valores = {};
  const partes = [['server', AREAS_SERVER], ['client', AREAS_CLIENT]];
  for (const [parte, areas] of partes) {
    const resumo = lerArtefato(`${parte}/coverage/coverage-summary.json`, rodada);
    const porArea = resumo ? md.coberturaPorArea(resumo, relativoA(parte), areas) : {};
    for (const area of areas) valores[`cobertura.${parte}.${area.replace('src/', '')}`] = porArea[area] ?? null;
  }
  return valores;
}

function coletarTestesETempos(rodada) {
  const tempos = lerArtefato('.qualidade/tempos.json', rodada) || {};
  const total = (parte) => lerArtefato(`.qualidade/testes-${parte}.json`, rodada)?.numTotalTests ?? null;
  return {
    'testes.server': total('server'),
    'testes.client': total('client'),
    'tempo.testes.server': tempos['testes:server'] ?? null,
    'tempo.testes.client': tempos['testes:client'] ?? null,
  };
}

function coletarLint(rodada) {
  const l = lerArtefato('.qualidade/lint.json', rodada);
  const de = (campo) => (l ? l[campo] : null);
  return {
    'lint.erros': de('erros'),
    'lint.avisos': de('avisos'),
    'lint.a11y': de('a11y'),
    complexidade: de('complexidade'),
    complexidadeMax: de('complexidadeMax'),
  };
}

function coletarCompletos(rodada) {
  const dup = lerArtefato('.qualidade/jscpd/jscpd-report.json', rodada);
  const deps = lerArtefato('.qualidade/deps.json', rodada) || {};
  return {
    duplicacaoPct: dup ? Math.round(dup.statistics.total.percentage * 100) / 100 : null,
    vulnAltas: deps.vulnAltas ?? null,
    depsMajorAtras: deps.depsMajorAtras ?? null,
  };
}

/** Todas as métricas do catálogo. `detalhes` guarda o que ajuda a consertar. */
export function coletarTudo({ rodada = null, hoje }) {
  const arquivos = listarArquivos();
  const { detalhesQuarentena, ...codigo } = coletarCodigo(arquivos, hoje);
  const valores = {
    ...codigo,
    ...coletarCobertura(rodada),
    ...coletarTestesETempos(rodada),
    ...coletarLint(rodada),
    ...coletarCompletos(rodada),
    cssSemUso: coletarCssSemUso(arquivos),
    bundleGzipKB: coletarBundle(rodada),
    codigoMorto: coletarCodigoMorto(arquivos),
    depsSemUso: coletarDepsSemUso(arquivos),
    segredos: coletarSegredos(arquivos),
    foraStrict: coletarForaStrict(arquivos),
  };
  return { valores, detalhes: { quarentena: detalhesQuarentena } };
}

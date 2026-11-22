/**
 * Medidas puras da catraca: recebem texto, devolvem número. Nenhum I/O aqui —
 * é o que deixa cada régua testável sem montar um repositório de mentira.
 *
 * Os padrões que procuram supressões, foco de teste etc. são montados por
 * concatenação: escritos por extenso, este próprio arquivo seria contado como
 * culpado pela régua que ele implementa.
 */
import ts from 'typescript';

export const LIMITE_LINHA = 160;

const LINHAS = /\r?\n/;
const DISABLE = ['eslint', 'disable'].join('-');
const TS_DIRETIVAS = ['@ts-' + 'ignore', '@ts-' + 'expect-error', '@ts-' + 'nocheck'];
const RE_SUPRESSAO = new RegExp(`${DISABLE}|${TS_DIRETIVAS.join('|')}`, 'g');
const RE_AS_ANY = new RegExp('\\bas ' + 'any\\b', 'g');
const RE_FOCO = new RegExp(['\\b(it|test|describe)\\.' + 'only\\(', '\\bf' + '(it|describe)\\('].join('|'));
const RE_RELOGIO_SOLTO = new RegExp(['new Date\\(' + '\\)', 'Date\\.' + 'now\\(\\)'].join('|'));
const RE_RELOGIO_FIXO = /useFakeTimers|setSystemTime|clock\.(install|setFixedTime|setSystemTime)/;
const RE_PULO = new RegExp(['\\b(it|test|describe)\\.' + 'skip\\(', '\\bx(it|describe)\\(', '\\b(it|test)\\.' + 'todo\\('].join('|'));
const RE_QUARENTENA = /QUARENTENA até (\d{4}-\d{2}-\d{2})/;
const MARCADORES = ['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'X' + 'XX'].join('|');
// Só conta como marcador o TODO que é marcador: seguido de "(" ou ":" ou fim de
// linha. "TODO o histórico" é português, não pendência.
const RE_MARCADOR = new RegExp(`(?://|/\\*|^\\s*\\*)\\s*(?:${MARCADORES})\\b(?=[(:]|\\s*$)`);
const RE_MARCADOR_OK = new RegExp(`(?:${MARCADORES})\\([^,)]+,\\s*\\d{4}-\\d{2}-\\d{2}\\):`);

export function contarLinhasLongas(texto, limite = LIMITE_LINHA) {
  return texto.split(LINHAS).filter((l) => l.length > limite).length;
}

/** Motivo de supressão = " -- texto" na mesma linha (convenção do próprio ESLint). */
export function temMotivo(trecho) {
  return /\s--\s+\S{3,}/.test(trecho);
}

export function contarSupressoes(texto) {
  const r = { eslintDisable: 0, eslintDisableSemMotivo: 0, tsDiretivas: 0 };
  for (const linha of texto.split(LINHAS)) {
    for (const m of linha.matchAll(RE_SUPRESSAO)) {
      if (m[0] !== DISABLE) { r.tsDiretivas++; continue; }
      r.eslintDisable++;
      if (!temMotivo(linha.slice(m.index))) r.eslintDisableSemMotivo++;
    }
  }
  return r;
}

export function contarAsAny(texto) {
  return (texto.match(RE_AS_ANY) || []).length;
}

/** Asserções de não-nulo (`x!`) contadas pela árvore de sintaxe, não por regex. */
export function contarNaoNulo(texto, nomeArquivo) {
  const tipo = nomeArquivo.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const fonte = ts.createSourceFile(nomeArquivo, texto, ts.ScriptTarget.Latest, false, tipo);
  let n = 0;
  const visitar = (no) => {
    if (no.kind === ts.SyntaxKind.NonNullExpression) n++;
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return n;
}

export function temFoco(texto) {
  return RE_FOCO.test(texto);
}

/** Teste que lê o relógio de verdade sem nunca fixá-lo. */
export function dependeDaData(texto) {
  return RE_RELOGIO_SOLTO.test(texto) && !RE_RELOGIO_FIXO.test(texto);
}

function somarDias(isoData, dias) {
  const d = new Date(`${isoData}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function problemaDaQuarentena(data, hoje) {
  if (!data) return 'sem "QUARENTENA até AAAA-MM-DD"';
  if (data < hoje) return `quarentena venceu em ${data}`;
  if (data > somarDias(hoje, 7)) return `prazo ${data} passa de 7 dias`;
  return null;
}

/**
 * Teste pulado só é aceito em quarentena: com a data de saída na mesma linha
 * ou na anterior, no máximo 7 dias à frente e ainda não vencida.
 */
export function analisarQuarentena(texto, hoje) {
  const linhas = texto.split(LINHAS);
  const r = { total: 0, irregulares: [] };
  linhas.forEach((linha, i) => {
    if (!RE_PULO.test(linha)) return;
    r.total++;
    const m = RE_QUARENTENA.exec(linha) || RE_QUARENTENA.exec(linhas[i - 1] || '');
    const problema = problemaDaQuarentena(m && m[1], hoje);
    if (problema) r.irregulares.push({ linha: i + 1, problema });
  });
  return r;
}

/** Marcador de pendência sem dono e data: `TODO(dono, AAAA-MM-DD): ...`. */
export function contarMarcadoresSemDono(texto) {
  return texto.split(LINHAS).filter((l) => RE_MARCADOR.test(l) && !RE_MARCADOR_OK.test(l)).length;
}

export function contarImgSemSrcset(texto) {
  const tags = texto.match(/<img\b[^>]*?(?:\/>|>)/gs) || [];
  return tags.filter((t) => !/srcSet|srcset/.test(t)).length;
}

/** Classes declaradas em seletores de um CSS (comentários, url() e strings fora). */
export function classesDoCss(css) {
  const limpo = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '')
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
  const classes = new Set();
  for (const [, seletor] of limpo.matchAll(/([^{}]+)\{/g)) {
    if (seletor.trim().startsWith('@')) continue;
    for (const [, c] of seletor.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) classes.add(c);
  }
  return [...classes].sort();
}

export function classesSemUso(classes, corpus, prefixosDeBiblioteca = ['recharts-']) {
  return classes.filter((c) => {
    if (prefixosDeBiblioteca.some((p) => c.startsWith(p))) return false;
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^\\w-])${esc}([^\\w-]|$)`).test(corpus);
  });
}

/** Piso de cobertura: arredondado para baixo em passos de 0,5. */
export function pisoMeio(valor) {
  return Math.floor(valor * 2) / 2;
}

/** Área = o prefixo mais longo da lista que casa com o caminho. */
export function areaDe(caminho, areas) {
  const ordenadas = [...areas].sort((a, b) => b.length - a.length);
  return ordenadas.find((a) => caminho === a || caminho.startsWith(`${a}/`)) || null;
}

/** Soma linhas cobertas/total por área a partir do coverage-summary.json. */
export function coberturaPorArea(resumo, relativo, areas) {
  const soma = {};
  for (const [arquivo, v] of Object.entries(resumo)) {
    if (arquivo === 'total') continue;
    const area = areaDe(relativo(arquivo), areas);
    if (!area) continue;
    soma[area] = soma[area] || { cobertas: 0, total: 0 };
    soma[area].cobertas += v.lines.covered;
    soma[area].total += v.lines.total;
  }
  const r = {};
  for (const area of areas) {
    const s = soma[area];
    r[area] = s && s.total > 0 ? Math.round((1000 * s.cobertas) / s.total) / 10 : null;
  }
  return r;
}

const RE_COMPLEXIDADE = /complexity of (\d+)/;

/** Resume as mensagens do ESLint: erros, avisos comuns, a11y e complexidade por arquivo. */
export function resumirLint(resultados, relativo) {
  const r = { erros: 0, avisos: 0, a11y: 0, complexidade: {}, complexidadeMax: 0 };
  for (const arquivo of resultados) {
    for (const m of arquivo.messages) contarMensagem(r, m, relativo(arquivo.filePath));
  }
  return r;
}

function contarMensagem(r, m, caminho) {
  if (m.ruleId === 'complexity') {
    const n = Number((RE_COMPLEXIDADE.exec(m.message) || [])[1] || 0);
    r.complexidade[caminho] = (r.complexidade[caminho] || 0) + 1;
    r.complexidadeMax = Math.max(r.complexidadeMax, n);
    return;
  }
  if (m.severity === 2) r.erros++;
  else if ((m.ruleId || '').startsWith('jsx-a11y/')) r.a11y++;
  else r.avisos++;
}

/** Quantas dependências estão mais de uma versão maior atrás (saída de `npm outdated --json`). */
export function contarMajorAtras(outdated) {
  const maior = (v) => parseInt(String(v || '0').split('.')[0], 10) || 0;
  return Object.values(outdated || {}).filter((v) => maior(v.latest) - maior(v.current) > 1).length;
}

/**
 * Código morto, sem dependência nova: arquivo que ninguém importa e export que
 * ninguém usa. "Usa" exclui teste — código que só o teste chama é apagado
 * (regra do CLAUDE.md), com a exceção explícita dos ganchos de teste, que
 * levam prefixo `_`/`__` (reset de estado, internals).
 *
 * É heurística por nome de arquivo e de export: erra para o lado de não acusar
 * (um nome repetido em outro módulo esconde um morto). Serve de catraca — o
 * número não sobe —, não de prova.
 */
import path from 'node:path';

const RE_IMPORT = /(?:from|import\()\s*['"]([^'"]+)['"]/g;
const RE_EXPORT = /export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/g;

const semExtensao = (f) => f.replace(/\.(js|jsx|ts|tsx|mjs)$/, '');

/** basename → arquivos que importam algo com esse nome. */
function indiceDeImportadores(corpus) {
  const indice = new Map();
  for (const { caminho, texto } of corpus) {
    for (const [, alvo] of texto.matchAll(RE_IMPORT)) {
      if (!alvo.startsWith('.') && !alvo.startsWith('@/')) continue;
      const nome = path.posix.basename(semExtensao(alvo));
      if (!indice.has(nome)) indice.set(nome, new Set());
      indice.get(nome).add(caminho);
    }
  }
  return indice;
}

function exportsMortos(arquivo, importadores, ehTeste) {
  const mortos = [];
  const deProducao = importadores.filter((g) => !ehTeste(g.caminho));
  for (const [, nome] of arquivo.texto.matchAll(RE_EXPORT)) {
    if (nome.startsWith('_')) continue;
    const palavra = new RegExp(`\\b${nome}\\b`);
    const usoInterno = (arquivo.texto.match(new RegExp(`\\b${nome}\\b`, 'g')) || []).length > 1;
    if (usoInterno || deProducao.some((g) => palavra.test(g.texto))) continue;
    const soTeste = importadores.some((g) => palavra.test(g.texto));
    mortos.push(`${arquivo.caminho}:${nome}${soTeste ? ' (só teste)' : ''}`);
  }
  return mortos;
}

/**
 * @param {{caminho: string, texto: string}[]} corpus  todo o código versionado
 * @param {{caminho: string, texto: string}[]} fontes  arquivos de produção avaliados
 * @param {{ehTeste: (f: string) => boolean, entradas: Set<string>}} opcoes
 * @returns {string[]} itens mortos, ordenados
 */
export function encontrarCodigoMorto(corpus, fontes, { ehTeste, entradas }) {
  const indice = indiceDeImportadores(corpus);
  const porCaminho = new Map(corpus.map((c) => [c.caminho, c]));
  const mortos = [];
  for (const arquivo of fontes) {
    if (entradas.has(arquivo.caminho)) continue;
    const nome = path.posix.basename(semExtensao(arquivo.caminho));
    const importadores = [...(indice.get(nome) || [])]
      .filter((g) => g !== arquivo.caminho)
      .map((g) => porCaminho.get(g));
    if (importadores.length === 0) { mortos.push(`${arquivo.caminho} (arquivo sem import)`); continue; }
    mortos.push(...exportsMortos(arquivo, importadores, ehTeste));
  }
  return mortos.sort();
}

/**
 * Dependência declarada que nenhum arquivo do pacote importa nem cita nos
 * configs/scripts. `implicitas` são as que a ferramenta carrega sozinha
 * (postcss pelo Vite, typescript pelo `tsc`).
 */
export function dependenciasSemUso(pkg, textos, implicitas = []) {
  const tudo = textos.join('\n') + JSON.stringify(pkg.scripts || {});
  return Object.keys(pkg.dependencies || {}).filter((dep) => {
    if (implicitas.includes(dep)) return false;
    const esc = dep.replace(/[/.]/g, (c) => `\\${c}`);
    return !new RegExp(`['"\\s]${esc}(/[^'"]*)?['":]|\\b${esc}\\b\\s*:`).test(tudo);
  });
}

/**
 * Placar de docs/medicoes.md: uma linha por métrica, uma coluna por data de
 * medição. Gerado entre marcadores; o resto do arquivo (motivos de
 * afrouxamento, notas) é escrito à mão e nunca é tocado aqui.
 */
import { resumirValor } from './catraca.mjs';

export const INICIO = '<!-- placar:inicio (gerado por npm run metricas -- --registrar; não edite à mão) -->';
export const FIM = '<!-- placar:fim -->';
const COLUNAS = 8;

/** Insere/atualiza a medição do dia (uma entrada por data). */
export function registrarNoHistorico(historico, data, valores) {
  const resumo = Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, resumirValor(v)]));
  return [...historico.filter((h) => h.data !== data), { data, valores: resumo }]
    .sort((a, b) => a.data.localeCompare(b.data));
}

const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

export function gerarTabela(catalogo, limites, historico) {
  const recentes = historico.slice(-COLUNAS);
  const cabecalho = `| Métrica | Limite | ${recentes.map((h) => h.data).join(' | ')} |`;
  const separador = `|---|---|${recentes.map(() => '---').join('|')}|`;
  const linhas = catalogo.map((def) => {
    const lim = def.tipo === 'info' ? 'info' : fmt(resumirValor(limites[def.chave]));
    const celulas = recentes.map((h) => fmt(h.valores[def.chave]));
    return `| \`${def.chave}\` — ${def.descricao} | ${lim} | ${celulas.join(' | ')} |`;
  });
  return [cabecalho, separador, ...linhas].join('\n');
}

/** Troca o trecho entre os marcadores; sem marcadores, acrescenta no fim. */
export function substituirPlacar(texto, tabela) {
  const bloco = `${INICIO}\n${tabela}\n${FIM}`;
  const i = texto.indexOf(INICIO);
  const f = texto.indexOf(FIM);
  if (i === -1 || f === -1) return `${texto.trimEnd()}\n\n${bloco}\n`;
  return texto.slice(0, i) + bloco + texto.slice(f + FIM.length);
}

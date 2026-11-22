/**
 * Série diária de índice da B3 (IFIX e afins) direto da fonte oficial.
 *
 * Existe porque o Yahoo não tem o IFIX e a brapi, no plano gratuito, só libera
 * range até 3 meses — e mesmo assim devolve um ponto só. O backtest pedia 5 anos
 * e a carteira recomendada 1 ano: os dois recebiam 400 em todo run e o IFIX
 * saía nulo dos relatórios.
 *
 * A B3 publica, por índice e por ano, uma tabela dia × mês com o fechamento
 * (`results[].day` + `rateValue1..12`, número em formato pt-BR). Uma chamada por
 * ano; dia sem pregão vem nulo e simplesmente não vira ponto — nunca se inventa
 * fechamento para preencher buraco (regra 13 do CLAUDE.md).
 */
import axios from 'axios';
import logger from '../config/logger.js';

const BASE = 'https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay';
const TIMEOUT_MS = 15_000;

/** "3.876,65" → 3876.65; vazio, nulo ou não-numérico → null. */
export function parseNumeroBr(valor) {
  if (valor === null || valor === undefined) return null;
  const n = Number(String(valor).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dataValida(ano, mes, dia) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 ? d.toISOString().slice(0, 10) : null;
}

/**
 * Converte a resposta de UM ano em pontos ascendentes `{ date, close }`.
 * Pura — é o que os testes exercitam.
 */
export function parseAnoB3(resposta, ano) {
  const pontos = [];
  for (const linha of resposta?.results || []) {
    for (let mes = 1; mes <= 12; mes++) {
      const close = parseNumeroBr(linha[`rateValue${mes}`]);
      const date = close === null ? null : dataValida(ano, mes, Number(linha.day));
      if (date) pontos.push({ date, close });
    }
  }
  return pontos.sort((a, b) => a.date.localeCompare(b.date));
}

async function buscarAno(indice, ano) {
  const payload = Buffer.from(JSON.stringify({ index: indice, language: 'pt-br', year: String(ano) })).toString('base64');
  const { data } = await axios.get(`${BASE}/${payload}`, { timeout: TIMEOUT_MS });
  return parseAnoB3(data, ano);
}

/**
 * Série ascendente desde `desde` (YYYY-MM-DD) até hoje. Ano que falha derruba a
 * série inteira (null): uma série com um ano faltando no meio daria retorno
 * acumulado errado sem ninguém perceber.
 */
export async function getB3IndexSeries(indice, desde, hoje = new Date()) {
  const anoInicial = Number(desde.slice(0, 4));
  const anoFinal = hoje.getUTCFullYear();
  try {
    const anos = [];
    for (let ano = anoInicial; ano <= anoFinal; ano++) anos.push(await buscarAno(indice, ano));
    const serie = anos.flat().filter((p) => p.date >= desde);
    return serie.length > 0 ? serie : null;
  } catch (err) {
    logger.warn(`⚠️ [B3] Série do ${indice} indisponível: ${err.message}`);
    return null;
  }
}

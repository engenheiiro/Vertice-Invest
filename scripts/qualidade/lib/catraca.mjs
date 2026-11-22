/**
 * A catraca em si: julgar uma medição contra o limite, apertar o limite depois
 * de um ganho e detectar afrouxamento entre duas versões da base. Funções puras.
 */

const passoDe = (def) => def.passo || 0;
const arredondarPiso = (v, passo) => (passo ? Math.floor(v / passo) * passo : v);
const tetoComFolga = (v, folga) => (folga ? Math.ceil(v * folga) : v);

/** Limite inicial a partir do valor de hoje (regra de ouro: não piora). */
export function limiteInicial(def, valor) {
  if (def.tipo === 'info') return null;
  if (def.fixo) return def.limiteFixo;
  if (def.tipo === 'max') return tetoComFolga(valor, def.folga);
  if (def.tipo === 'min') return arredondarPiso(valor, passoDe(def));
  if (def.tipo === 'mapa') return filtrarMapa(valor, def.padrao);
  return [...valor].sort();
}

function filtrarMapa(mapa, padrao) {
  return Object.fromEntries(Object.entries(mapa).filter(([, n]) => n > padrao).sort(([a], [b]) => a.localeCompare(b)));
}

function avaliarMapa(def, limite, valor) {
  const estourados = Object.entries(valor)
    .filter(([k, n]) => n > (limite[k] ?? def.padrao))
    .map(([k, n]) => `${k}: ${n} > ${limite[k] ?? def.padrao}`);
  if (estourados.length) return { estado: 'piorou', detalhe: estourados };
  const ganhos = Object.entries(limite).filter(([k, teto]) => (valor[k] ?? 0) < teto);
  return ganhos.length ? { estado: 'melhorou', detalhe: ganhos.map(([k]) => k) } : { estado: 'ok' };
}

function avaliarLista(limite, valor) {
  const permitidos = new Set(limite);
  const novos = valor.filter((v) => !permitidos.has(v));
  if (novos.length) return { estado: 'piorou', detalhe: novos };
  const atuais = new Set(valor);
  const saiu = limite.filter((v) => !atuais.has(v));
  return saiu.length ? { estado: 'melhorou', detalhe: saiu } : { estado: 'ok' };
}

function avaliarNumero(def, limite, valor) {
  if (def.tipo === 'max') {
    if (valor > limite) return { estado: 'piorou' };
    return !def.fixo && tetoComFolga(valor, def.folga) < limite ? { estado: 'melhorou' } : { estado: 'ok' };
  }
  if (valor < limite) return { estado: 'piorou' };
  return arredondarPiso(valor, passoDe(def)) > limite ? { estado: 'melhorou' } : { estado: 'ok' };
}

/** @returns {{estado: 'ok'|'piorou'|'melhorou'|'nao-medido', detalhe?: string[]}} */
export function avaliar(def, limite, valor) {
  if (valor === null || valor === undefined) return { estado: 'nao-medido' };
  if (def.tipo === 'info') return { estado: 'ok' };
  if (def.tipo === 'mapa') return avaliarMapa(def, limite, valor);
  if (def.tipo === 'lista') return avaliarLista(limite, valor);
  return avaliarNumero(def, limite, valor);
}

/** Novo limite depois de um ganho. Nunca afrouxa: só trava o que melhorou. */
export function apertar(def, limite, valor) {
  if (def.fixo || def.tipo === 'info' || valor === null || valor === undefined) return limite;
  if (def.tipo === 'max') return Math.min(limite, tetoComFolga(valor, def.folga));
  if (def.tipo === 'min') return Math.max(limite, arredondarPiso(valor, passoDe(def)));
  if (def.tipo === 'lista') return limite.filter((v) => valor.includes(v));
  const novo = {};
  for (const [k, teto] of Object.entries(limite)) {
    const atual = valor[k] ?? 0;
    if (atual > def.padrao) novo[k] = Math.min(teto, atual);
  }
  return novo;
}

function afrouxouMapa(def, antes, depois) {
  return Object.entries(depois).some(([k, teto]) => teto > (antes[k] ?? def.padrao));
}

/** Limite `depois` é mais frouxo que `antes`? */
export function afrouxou(def, antes, depois) {
  if (antes === undefined || def.tipo === 'info') return false;
  if (depois === undefined) return true;
  if (def.tipo === 'max') return depois > antes;
  if (def.tipo === 'min') return depois < antes;
  if (def.tipo === 'lista') return depois.some((v) => !antes.includes(v));
  return afrouxouMapa(def, antes, depois);
}

/** Chaves afrouxadas entre duas versões de docs/metricas.json. */
export function listarAfrouxamentos(catalogo, baseAntes, baseDepois) {
  const antes = baseAntes?.limites || {};
  const depois = baseDepois?.limites || {};
  return catalogo.filter((def) => afrouxou(def, antes[def.chave], depois[def.chave])).map((d) => d.chave);
}

/**
 * Todo afrouxamento precisa de motivo escrito em docs/medicoes.md, numa linha
 * da seção "## Afrouxamentos" que cite a chave da métrica.
 */
export function afrouxamentosSemMotivo(chaves, textoMedicoes) {
  const secao = (textoMedicoes.split(/^## Afrouxamentos\s*$/m)[1] || '').split(/^## /m)[0];
  return chaves.filter((c) => !secao.includes(`\`${c}\``));
}

/** Resumo de um valor para placar e histórico (mapa/lista viram contagem). */
export function resumirValor(valor) {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return valor.length;
  if (typeof valor === 'object') return Object.keys(valor).length;
  return valor;
}

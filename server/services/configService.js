/**
 * (I13) Tunables operacionais editáveis em runtime pelo admin, sem deploy.
 *
 * Guardados em SystemConfig (key APP_TUNABLES, campo `value`) e mantidos num
 * snapshot em memória com TTL curto, para que consumidores quentes (engines)
 * leiam de forma síncrona e barata via `getTunablesSync()`.
 *
 * Defaults = constantes do M9 (financialConstants). Se o banco estiver
 * desconectado (ex.: testes unitários puros), NÃO consultamos o Mongo — o
 * snapshot fica nos defaults, preservando o comportamento atual.
 */
import mongoose from 'mongoose';
import SystemConfig from '../models/SystemConfig.js';
import logger from '../config/logger.js';
import {
  MAX_CRYPTO_PER_PROFILE,
  MARKET_CACHE_DURATION_MINUTES,
  DEFAULT_SELIC_FALLBACK,
} from '../config/financialConstants.js';

export const TUNABLE_KEY = 'APP_TUNABLES';

// Definição dos tunables: default + faixa válida (validação no update).
export const TUNABLE_DEFS = {
  maxCryptoPerProfile: { default: MAX_CRYPTO_PER_PROFILE, min: 0, max: 10, label: 'Máx. de criptos por perfil' },
  marketCacheMinutes: { default: MARKET_CACHE_DURATION_MINUTES, min: 1, max: 1440, label: 'Cache de cotações (min)' },
  defaultSelicFallback: { default: DEFAULT_SELIC_FALLBACK, min: 0, max: 100, label: 'Selic/CDI de fallback (%)' },
};

const DEFAULTS = Object.fromEntries(Object.entries(TUNABLE_DEFS).map(([k, d]) => [k, d.default]));
const TTL_MS = 60_000;

let snapshot = { ...DEFAULTS };
let loadedAt = 0;

// Mantém apenas chaves conhecidas e dentro da faixa; descarta o resto.
const sanitize = (obj = {}) => {
  const out = {};
  for (const [key, def] of Object.entries(TUNABLE_DEFS)) {
    const v = Number(obj[key]);
    if (Number.isFinite(v) && v >= def.min && v <= def.max) out[key] = v;
  }
  return out;
};

export const refreshTunables = async () => {
  // Sem conexão (testes puros) → não consulta o Mongo; mantém os defaults.
  if (mongoose.connection?.readyState !== 1) {
    loadedAt = Date.now();
    return snapshot;
  }
  try {
    const doc = await SystemConfig.findOne({ key: TUNABLE_KEY }).lean();
    snapshot = { ...DEFAULTS, ...sanitize(doc?.value) };
    loadedAt = Date.now();
  } catch (e) {
    logger.warn(`[configService] Falha ao carregar tunables: ${e.message}. Usando snapshot atual.`);
  }
  return snapshot;
};

// Assíncrono — garante snapshot fresco (await do refresh se expirado).
export const getTunables = async () => {
  if (Date.now() - loadedAt > TTL_MS) await refreshTunables();
  return { ...snapshot };
};

// Síncrono — devolve o snapshot atual; se expirado, dispara refresh em background.
export const getTunablesSync = () => {
  // Refresh em background (não-bloqueante): o caller usa o snapshot atual neste
  // tick e pega o novo no próximo. Falha é logada, não silenciada.
  if (Date.now() - loadedAt > TTL_MS) {
    refreshTunables().catch(err => logger.warn(`[Config] Refresh de tunables em background falhou: ${err.message}`));
  }
  return snapshot;
};

export const updateTunables = async (patch) => {
  const clean = sanitize(patch);
  if (Object.keys(clean).length === 0) {
    const err = new Error('Nenhum parâmetro válido para atualizar.');
    err.status = 400;
    throw err;
  }
  const merged = { ...DEFAULTS, ...sanitize(snapshot), ...clean };
  const doc = await SystemConfig.findOneAndUpdate(
    { key: TUNABLE_KEY },
    { $set: { key: TUNABLE_KEY, value: merged, lastUpdated: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  snapshot = { ...DEFAULTS, ...sanitize(doc?.value) };
  loadedAt = Date.now();
  logger.info(`[configService] Tunables atualizados: ${JSON.stringify(clean)}`);
  return snapshot;
};

// Para o painel admin: valor atual + metadados (default/faixa/label) de cada tunable.
export const describeTunables = async () => {
  const current = await getTunables();
  return Object.entries(TUNABLE_DEFS).map(([key, def]) => ({
    key,
    label: def.label,
    value: current[key],
    default: def.default,
    min: def.min,
    max: def.max,
  }));
};

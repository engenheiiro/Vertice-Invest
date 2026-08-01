import { BR_ETF_LIST } from '../config/brEtfList.js';

export const ALLOCATION_CLASSES = Object.freeze([
  'STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH', 'OURO',
]);

const VALID_CLASSES = new Set(ALLOCATION_CLASSES);
const BR_ETF_CLASS_BY_TICKER = new Map(
  BR_ETF_LIST
    .filter((asset) => VALID_CLASSES.has(asset.allocationClass))
    .map((asset) => [asset.ticker, asset.allocationClass]),
);

const normalized = (value) => String(value || '').trim().toUpperCase();

/**
 * Resolve a classe econômica sem alterar o tipo jurídico nem a moeda do ativo.
 * Para não permitir que metadados ruins remapeiem ações comuns, o override só é
 * aplicado a ETFs; os demais ativos continuam em sua própria classe.
 */
export const resolveAllocationClass = (asset = {}) => {
  const type = normalized(asset.type);
  if (type !== 'ETF') return VALID_CLASSES.has(type) ? type : 'STOCK';

  const explicit = normalized(asset.allocationClass);
  if (VALID_CLASSES.has(explicit)) return explicit;

  const configured = BR_ETF_CLASS_BY_TICKER.get(normalized(asset.ticker));
  if (configured) return configured;

  // Compatibilidade para ETFs já presentes no banco antes do campo novo e para
  // futuros seeds cujo setor siga a taxonomia "Exterior (...)".
  if (normalized(asset.sector).startsWith('EXTERIOR')) return 'STOCK_US';

  return 'STOCK';
};

/** Classe efetiva incluindo a regra de Reserva separada. */
export const allocationBucket = (asset = {}) =>
  (asset.isReserve ?? (asset.type === 'CASH')) ? 'CASH' : resolveAllocationClass(asset);

/** Subtipo no balde Exterior; ETF local internacional sempre é ETF. */
export const exteriorSubType = (asset = {}) =>
  resolveAllocationClass(asset) === 'STOCK_US' && normalized(asset.type) === 'ETF'
    ? 'ETF'
    : (asset.usSubType || null);

export default { resolveAllocationClass, allocationBucket, exteriorSubType };

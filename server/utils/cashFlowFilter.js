import { allocationBucket } from './assetAllocation.js';

export const CASH_FLOW_CLASS_FILTERS = Object.freeze([
  'STOCK',
  'FII',
  'ETF',
  'CRYPTO',
  'FIXED_INCOME',
  'STOCK_US',
  'OURO',
]);

const CLASS_FILTERS = new Set(CASH_FLOW_CLASS_FILTERS);
const normalized = (value) => String(value || '').trim().toUpperCase();

/**
 * Traduz o filtro visual do Extrato para a condição de ticker usada no MongoDB.
 * A classificação parte da posição atual porque AssetTransaction guarda o fato
 * financeiro, enquanto UserAsset é a fonte autoritativa da classe econômica.
 */
export const cashFlowTickerCondition = (assets = [], filterType = 'ALL') => {
  const filter = normalized(filterType);
  if (!filter || filter === 'ALL') return undefined;

  const classified = assets.map((asset) => ({
    ticker: normalized(asset.ticker),
    bucket: allocationBucket(asset),
    type: normalized(asset.type),
  }));
  const reserveTickers = classified
    .filter(({ bucket }) => bucket === 'CASH')
    .map(({ ticker }) => ticker);

  if (filter === 'CASH') return { $in: reserveTickers };
  if (filter === 'TRADE') return { $nin: reserveTickers };
  if (CLASS_FILTERS.has(filter)) {
    return {
      $in: classified
        .filter(({ bucket, type }) => {
          if (bucket === 'CASH') return false;
          // ETF é um tipo explícito no cadastro. Nos demais chips, evitamos que
          // ele apareça duplicado em Ações/Exterior só por sua exposição econômica.
          if (filter === 'ETF') return type === 'ETF';
          if (filter === 'OURO') return bucket === 'OURO';
          return type === filter;
        })
        .map(({ ticker }) => ticker),
    };
  }

  // Compatibilidade com clientes antigos ou parâmetros manuais desconhecidos:
  // não esconder o extrato inteiro por causa de um valor inválido.
  return undefined;
};

import { describe, expect, it } from 'vitest';
import { cashFlowTickerCondition } from '../utils/cashFlowFilter.js';

const assets = [
  { ticker: 'RESERVA', type: 'CASH' },
  { ticker: 'PETR4', type: 'STOCK' },
  { ticker: 'HGLG11', type: 'FII' },
  { ticker: 'BTC', type: 'CRYPTO' },
  { ticker: 'TESOURO SELIC', type: 'FIXED_INCOME' },
  { ticker: 'EMERGENCIA', type: 'FIXED_INCOME', isReserve: true },
  { ticker: 'IVVB11', type: 'ETF', allocationClass: 'STOCK_US' },
  { ticker: 'GOLD11', type: 'ETF', allocationClass: 'OURO' },
  { ticker: 'AAPL', type: 'STOCK_US' },
];

describe('filtros por classe do Extrato', () => {
  it('mantém Tudo sem condição e Investimentos exclui a reserva efetiva', () => {
    expect(cashFlowTickerCondition(assets, 'ALL')).toBeUndefined();
    expect(cashFlowTickerCondition(assets, 'TRADE')).toEqual({ $nin: ['RESERVA', 'EMERGENCIA'] });
  });

  it('inclui renda fixa marcada como reserva no filtro Reserva', () => {
    expect(cashFlowTickerCondition(assets, 'CASH')).toEqual({ $in: ['RESERVA', 'EMERGENCIA'] });
  });

  it('separa os tipos de ativo, inclusive ETFs e Ouro', () => {
    expect(cashFlowTickerCondition(assets, 'STOCK')).toEqual({ $in: ['PETR4'] });
    expect(cashFlowTickerCondition(assets, 'FII')).toEqual({ $in: ['HGLG11'] });
    expect(cashFlowTickerCondition(assets, 'CRYPTO')).toEqual({ $in: ['BTC'] });
    expect(cashFlowTickerCondition(assets, 'FIXED_INCOME')).toEqual({ $in: ['TESOURO SELIC'] });
    expect(cashFlowTickerCondition(assets, 'ETF')).toEqual({ $in: ['IVVB11', 'GOLD11'] });
    expect(cashFlowTickerCondition(assets, 'STOCK_US')).toEqual({ $in: ['AAPL'] });
    expect(cashFlowTickerCondition(assets, 'OURO')).toEqual({ $in: ['GOLD11'] });
  });

  it('ignora filtros desconhecidos em vez de ocultar o histórico', () => {
    expect(cashFlowTickerCondition(assets, 'INVALIDO')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { ROW_STATUS, classifyInDateOrder, dedupKey, summarizeTicker } from '../utils/importPreview.js';

// Regras puras da prévia de importação: classificação em ordem de data e
// posição resultante por ticker. Sem banco: os mapas vêm prontos.

const day = (iso) => new Date(`${iso}T12:00:00.000Z`);
const maps = (over = {}) => ({
    catalogByTicker: new Map([['PETR4', { ticker: 'PETR4', type: 'STOCK', name: 'Petrobras' }]]),
    positionByTicker: new Map(),
    alreadyThere: new Set(),
    ...over,
});

describe('classifyInDateOrder', () => {
    it('a repetição dentro do arquivo é a ocorrência MAIS TARDE, mesmo listada antes', () => {
        const linha = { ticker: 'PETR4', side: 'BUY', quantity: 10, price: 30 };
        const rows = classifyInDateOrder([{ ...linha, date: day('2024-03-01') }, { ...linha, date: day('2024-03-01') }], maps());
        expect(rows.map((r) => r.status)).toEqual([ROW_STATUS.OK, ROW_STATUS.DUPLICADO]);
    });

    it('ativo fora do catálogo fica marcado como "só falta a classe"', () => {
        const [row] = classifyInDateOrder([{ ticker: 'XPTO11', side: 'BUY', quantity: 1, price: 10, date: day('2024-01-02') }], maps());
        expect(row).toMatchObject({ status: ROW_STATUS.NAO_RECONHECIDO, type: null, currency: 'BRL', soFaltaClasse: true });
    });

    it('lançamento já gravado vira duplicado pela chave de preço unitário', () => {
        const gravado = { ticker: 'PETR4', side: 'BUY', quantity: 10, price: 0.00001234, date: day('2024-03-01') };
        const [row] = classifyInDateOrder([{ ...gravado, price: 0.00001567 }], maps({ alreadyThere: new Set([dedupKey(gravado)]) }));
        expect(row.status).toBe(ROW_STATUS.OK);
    });
});

describe('summarizeTicker', () => {
    it('parte da posição existente e desconta a venda pelo preço médio', () => {
        const linhas = [
            { ticker: 'PETR4', side: 'BUY', quantity: 10, price: 20, status: ROW_STATUS.OK, type: 'STOCK', currency: 'BRL', date: day('2024-01-02') },
            { ticker: 'PETR4', side: 'SELL', quantity: 5, price: 50, status: ROW_STATUS.OK, type: 'STOCK', currency: 'BRL', date: day('2024-02-02') },
            { ticker: 'PETR4', side: 'BUY', quantity: 99, price: 1, status: ROW_STATUS.DUPLICADO, date: day('2024-02-03') },
        ];
        const out = summarizeTicker('PETR4', linhas, maps({ positionByTicker: new Map([['PETR4', { quantity: 10 }]]) }));
        expect(out).toMatchObject({ rows: 3, quantity: 15, totalCost: 150, averagePrice: 10, hadPosition: true, name: 'Petrobras' });
    });
});

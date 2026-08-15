import { describe, expect, it } from 'vitest';
import type { Asset } from '../contexts/WalletContext';
import {
    ETF_SECTOR_LABEL,
    SECTOR_COLORS,
    SECTOR_MUTED_COLOR,
    UNKNOWN_SECTOR_LABEL,
    computeSectorAllocation,
    fiiSectorLabel,
    stockSectorLabel,
} from './sectorAllocation';

const holding = (ticker: string, totalValue: number, sector?: string, type = 'FII'): Asset => ({
    id: ticker,
    ticker,
    type,
    quantity: 1,
    averagePrice: totalValue,
    currentPrice: totalValue,
    totalValue,
    totalCost: totalValue,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    sector,
} as unknown as Asset);

const fii = (ticker: string, totalValue: number, sector?: string) => holding(ticker, totalValue, sector, 'FII');
const stock = (ticker: string, totalValue: number, sector?: string) => holding(ticker, totalValue, sector, 'STOCK');

describe('fiiSectorLabel', () => {
    it('normaliza acento, caixa e sinônimos do Fundamentus', () => {
        expect(fiiSectorLabel('Títulos e Val. Mob.')).toBe('Papel (CRI)');
        expect(fiiSectorLabel('LOGÍSTICA')).toBe('Logística');
        expect(fiiSectorLabel('Lajes  Corporativas')).toBe('Lajes Corporativas');
        expect(fiiSectorLabel('Agências de Bancos')).toBe('Renda Urbana');
    });

    it('preserva segmento fora do canon em vez de colapsar em "Outros"', () => {
        expect(fiiSectorLabel('Data Centers')).toBe('Data Centers');
    });

    it('trata segmento ausente como não classificado', () => {
        expect(fiiSectorLabel(undefined)).toBe(UNKNOWN_SECTOR_LABEL);
        expect(fiiSectorLabel('   ')).toBe(UNKNOWN_SECTOR_LABEL);
    });
});

describe('stockSectorLabel', () => {
    it('agrupa setores correlacionados no mesmo macro-setor', () => {
        expect(stockSectorLabel(stock('ITUB4', 1, 'Bancos'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('BBSE3', 1, 'Seguros'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('TAEE11', 1, 'Energia Elétrica'))).toBe('Utilidade Pública');
        expect(stockSectorLabel(stock('VALE3', 1, 'Mineração'))).toBe('Commodities');
    });

    it('desambigua "Papel" (recebíveis) de "Papel e Celulose" (commodity)', () => {
        expect(stockSectorLabel(stock('X', 1, 'Papel'))).toBe('Financeiro');
        expect(stockSectorLabel(stock('KLBN11', 1, 'Papel e Celulose'))).toBe('Commodities');
    });

    it('entende setor em inglês vindo do Yahoo', () => {
        expect(stockSectorLabel(stock('X', 1, 'Consumer Cyclical'))).toBe('Consumo');
        expect(stockSectorLabel(stock('Y', 1, 'Basic Materials'))).toBe('Commodities');
    });

    it('não força um ETF de índice dentro de um setor', () => {
        expect(stockSectorLabel(holding('BOVA11', 1, 'Índice Amplo', 'ETF'))).toBe(ETF_SECTOR_LABEL);
    });

    it('cai em não classificado quando o setor é desconhecido ou ausente', () => {
        expect(stockSectorLabel(stock('X', 1))).toBe(UNKNOWN_SECTOR_LABEL);
        expect(stockSectorLabel(stock('X', 1, 'Setor Inexistente'))).toBe(UNKNOWN_SECTOR_LABEL);
    });
});

describe('computeSectorAllocation — FII', () => {
    it('agrega por segmento, ordena por saldo e soma 100%', () => {
        const slices = computeSectorAllocation([
            fii('HGLG11', 300, 'Logística'),
            fii('XPLG11', 100, 'Imóveis Industriais e Logísticos'),
            fii('VISC11', 600, 'Shoppings'),
        ], 'FII');

        expect(slices.map((s) => [s.label, s.value, s.tickers])).toEqual([
            ['Shoppings', 600, ['VISC11']],
            ['Logística', 400, ['HGLG11', 'XPLG11']],
        ]);
        expect(slices.map((s) => s.pct)).toEqual([60, 40]);
        expect(slices.map((s) => s.color)).toEqual([SECTOR_COLORS[0], SECTOR_COLORS[1]]);
    });

    it('ignora saldo zerado/negativo e carteira sem posição', () => {
        expect(computeSectorAllocation([], 'FII')).toEqual([]);
        expect(computeSectorAllocation([fii('KNCR11', 0, 'Papel')], 'FII')).toEqual([]);
    });

    it('joga o não classificado para o fim, em cinza, sem gastar cor de setor real', () => {
        const slices = computeSectorAllocation([
            fii('SEM11', 900),
            fii('VISC11', 100, 'Shoppings'),
        ], 'FII');

        expect(slices.map((s) => s.label)).toEqual(['Shoppings', UNKNOWN_SECTOR_LABEL]);
        expect(slices[0].color).toBe(SECTOR_COLORS[0]);
        expect(slices[1].color).toBe(SECTOR_MUTED_COLOR);
    });

    it('dobra a cauda em "Outros segmentos" acima do teto de fatias', () => {
        const slices = computeSectorAllocation([
            fii('A11', 100, 'Shoppings'),
            fii('B11', 90, 'Logística'),
            fii('C11', 80, 'Lajes Corporativas'),
            fii('D11', 70, 'Papel'),
            fii('E11', 60, 'Fiagro'),
            fii('F11', 50, 'Hotéis'),
            fii('G11', 40, 'Residencial'),
            fii('H11', 10),
        ], 'FII');

        expect(slices).toHaveLength(6);
        expect(slices[5].label).toBe('Outros segmentos');
        // Hotéis + Residencial + não classificado.
        expect(slices[5].value).toBe(100);
        expect(slices[5].tickers).toEqual(['F11', 'G11', 'H11']);
        expect(slices[5].color).toBe(SECTOR_MUTED_COLOR);
        expect(slices.reduce((acc, s) => acc + s.pct, 0)).toBeCloseTo(100, 10);
    });
});

describe('computeSectorAllocation — Ações', () => {
    it('junta bancos e seguros num único macro-setor', () => {
        const slices = computeSectorAllocation([
            stock('ITUB4', 300, 'Bancos'),
            stock('BBSE3', 200, 'Seguros'),
            stock('TAEE11', 500, 'Energia Elétrica'),
        ], 'STOCK');

        // Empate em saldo desempata pelo rótulo, não pela ordem que a API devolveu.
        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            ['Financeiro', 50],
            ['Utilidade Pública', 50],
        ]);
        expect(slices[0].tickers).toEqual(['ITUB4', 'BBSE3']);
    });

    it('separa ETFs de índice das ações individuais', () => {
        const slices = computeSectorAllocation([
            stock('PETR4', 400, 'Petróleo, Gás e Biocombustíveis'),
            holding('BOVA11', 600, 'Índice Amplo', 'ETF'),
        ], 'STOCK');

        expect(slices.map((s) => [s.label, s.pct])).toEqual([
            [ETF_SECTOR_LABEL, 60],
            ['Commodities', 40],
        ]);
    });

    it('dobra a cauda em "Outros setores" acima do teto de fatias', () => {
        const slices = computeSectorAllocation([
            stock('A3', 100, 'Bancos'),
            stock('B3', 90, 'Energia Elétrica'),
            stock('C3', 80, 'Mineração'),
            stock('D3', 70, 'Varejo'),
            stock('E3', 60, 'Bens Industriais'),
            stock('F3', 50, 'Tecnologia'),
            stock('G3', 40, 'Saúde'),
        ], 'STOCK');

        expect(slices).toHaveLength(6);
        expect(slices[5].label).toBe('Outros setores');
        expect(slices[5].value).toBe(90);
        expect(slices[5].tickers).toEqual(['F3', 'G3']);
    });
});

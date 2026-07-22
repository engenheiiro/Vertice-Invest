/**
 * 6.7 — Raspadores versionados: validateFundamentusLayout detecta quando a
 * estrutura HTML do Fundamentus muda (índices de coluna defasados), evitando a
 * falha silenciosa de dados zerados/trocados.
 *
 * A validação roda sobre a 1ª LINHA DE DADOS (tbody td) — a mesma fonte da
 * extração — e não sobre o <thead>, justamente para não dar falso positivo quando
 * o cabeçalho do site diverge do corpo em uma coluna (bug real observado em jun/2026).
 */
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import {
    FUNDAMENTUS_STOCKS_LAYOUT,
    FUNDAMENTUS_FIIS_LAYOUT,
    validateFundamentusLayout,
} from '../config/scraperSchemas.js';

// Monta a tabela do layout com um <thead> opcional e uma linha de dados (<tbody>).
const buildTable = (tableSelector, dataCells, headerCells = null) => {
    const id = tableSelector.replace('table#', '');
    const head = headerCells
        ? `<thead><tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
        : '';
    const body = `<tbody><tr>${dataCells.map((c) => `<td>${c}</td>`).join('')}</tr></tbody>`;
    return cheerio.load(`<table id="${id}">${head}${body}</table>`);
};

// Variante com várias linhas de dados (cada `row` = array de células).
const buildTableMulti = (tableSelector, dataRows, headerCells = null) => {
    const id = tableSelector.replace('table#', '');
    const head = headerCells
        ? `<thead><tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
        : '';
    const trs = dataRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return cheerio.load(`<table id="${id}">${head}<tbody>${trs}</tbody></table>`);
};

const STOCK_HEADERS = [
    'Papel', 'Cotação', 'P/L', 'P/VP', 'PSR', 'Div.Yield', 'P/Ativo',
    'P/Cap.Giro', 'P/EBIT', 'P/Ativ Circ.Liq', 'EV/EBIT', 'EV/EBITDA',
    'Mrg Bruta', 'Mrg Ebit', 'Mrg. Líq.', 'Liq. Corr.', 'ROIC', 'ROE',
    'Liq.2meses', 'Patrim. Líq', 'Dív.Líq/ Patrim.', 'Cresc. Rec.5a',
];

// Linha de dados realista de AÇÕES (22 colunas, índices 0..21 do layout v2).
const STOCK_ROW = [
    'PETR4', '38,80', '9,47', '1,76', '1,20', '8,81', '1,10', '3,50', '4,20',
    '2,10', '5,10', '4,80', '42,0%', '25,3%', '18,2%', '1,30', '15,4%', '18,58%',
    '432.160.000', '59.160.000.000', '0,12', '-0,11%',
];

const FII_HEADERS = [
    'Papel', 'Segmento', 'Cotação', 'FFO Yield', 'Dividend Yield', 'P/VP',
    'Valor de Mercado', 'Liquidez', 'Qtd de imóveis', 'Preço do m2',
    'Aluguel por m2', 'Cap Rate', 'Vacância Média', 'Endereço',
];

// Linha de dados realista de FIIs (14 colunas, índices 0..13 do layout v2).
const FII_ROW = [
    'HGLG11', 'Logística', '160,50', '8,5%', '9,2%', '0,98', '12.000.000.000',
    '5.000.000', '20', '1.200', '8,5', '7,8%', '3,2%', 'Rua Exemplo, 123',
];

describe('validateFundamentusLayout — AÇÕES', () => {
    it('aceita uma linha de dados válida', () => {
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW, STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(true);
        expect(res.mismatches).toHaveLength(0);
        expect(res.version).toBe(FUNDAMENTUS_STOCKS_LAYOUT.version);
    });

    it('regressão: 1ª linha com patrimônio 0 mas 2ª linha válida → ainda válido', () => {
        // Caso real: a 1ª linha do Fundamentus tinha Patrim. Líq. "0,00" (empresa com
        // PL zerado/negativo). Basta UMA linha limpa nas primeiras 5 para validar.
        const rowZeroPL = [...STOCK_ROW];
        rowZeroPL[FUNDAMENTUS_STOCKS_LAYOUT.columns.patrimLiq] = '0,00';
        const $ = buildTableMulti(FUNDAMENTUS_STOCKS_LAYOUT.table, [rowZeroPL, STOCK_ROW], STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(true);
    });

    it('shift real quebra TODAS as linhas → inválido', () => {
        // Coluna extra no início do corpo em ambas as linhas → ticker/preço deslocam.
        const r1 = ['LIXO', ...STOCK_ROW];
        const r2 = ['LIXO', ...STOCK_ROW];
        const $ = buildTableMulti(FUNDAMENTUS_STOCKS_LAYOUT.table, [r1, r2], STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
    });

    it('regressão: cabeçalho com coluna EXTRA é inválido', () => {
        const headerComExtra = [...STOCK_HEADERS.slice(0, 12), 'EXTRA', ...STOCK_HEADERS.slice(12)];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW, headerComExtra);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches[0]).toContain('cabeçalho');
    });

    it('layout legado de 21 colunas sem Mrg Bruta é inválido', () => {
        const legacyHeaders = STOCK_HEADERS.filter((_, i) => i !== 12);
        const legacyRow = STOCK_ROW.filter((_, i) => i !== 12);
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, legacyRow, legacyHeaders);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches[0]).toContain('21 colunas');
    });

    it('regressão jul/2026: coluna numérica inserida no meio do corpo é inválida', () => {
        const oldRowShifted = [...STOCK_ROW.slice(0, 12), '99,9%', ...STOCK_ROW.slice(12)];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, oldRowShifted, STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches.some(m => m.includes('linha com 23 colunas'))).toBe(true);
    });

    it('reordenação semântica no cabeçalho é inválida mesmo com células numéricas', () => {
        const swappedHeaders = [...STOCK_HEADERS];
        [swappedHeaders[17], swappedHeaders[18]] = [swappedHeaders[18], swappedHeaders[17]];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW, swappedHeaders);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches.some(m => m.includes('(roe)'))).toBe(true);
    });

    it('acusa divergência quando colunas saem do lugar (ticker no lugar do preço)', () => {
        // Insere uma coluna no início do CORPO → ticker e preço deslocam, invariantes quebram.
        const deslocada = ['LIXO', ...STOCK_ROW];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, deslocada, STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches.length).toBeGreaterThan(0);
    });

    it('acusa linha com menos colunas que o esperado (layout truncado)', () => {
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW.slice(0, 10), STOCK_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
    });

    it('acusa linha de dados ausente (tabela bloqueada/vazia)', () => {
        const $ = cheerio.load('<div>sem tabela</div>');
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches).toContain('linha de dados não encontrada');
    });
});

describe('validateFundamentusLayout — FIIs', () => {
    it('aceita uma linha de dados válida', () => {
        const $ = buildTable(FUNDAMENTUS_FIIS_LAYOUT.table, FII_ROW, FII_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_FIIS_LAYOUT);
        expect(res.ok).toBe(true);
        expect(res.mismatches).toHaveLength(0);
    });

    it('acusa célula-chave inválida em linha de largura correta (preço zerado)', () => {
        // Linha completa (13 col) mas preço = 0 → positiveNumber falha. Isola o invariante
        // da checagem de largura.
        const ruim = [...FII_ROW];
        ruim[FUNDAMENTUS_FIIS_LAYOUT.columns.price] = '0';
        const $ = buildTable(FUNDAMENTUS_FIIS_LAYOUT.table, ruim, FII_HEADERS);
        const res = validateFundamentusLayout($, FUNDAMENTUS_FIIS_LAYOUT);
        expect(res.ok).toBe(false);
    });
});

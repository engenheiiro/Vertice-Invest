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
const buildTableMulti = (tableSelector, dataRows) => {
    const id = tableSelector.replace('table#', '');
    const trs = dataRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return cheerio.load(`<table id="${id}"><tbody>${trs}</tbody></table>`);
};

// Linha de dados realista de AÇÕES (21 colunas, índices 0..20 do layout).
const STOCK_ROW = [
    'PETR4', '38,80', '9,47', '1,76', '1,20', '8,81', '1,10', '3,50', '4,20',
    '2,10', '5,10', '4,80', '25,3%', '18,2%', '1,30', '0,25%', '18,58%',
    '432.160.000', '59.160.000.000', '0,12', '-0,11%',
];

// Linha de dados realista de FIIs (13 colunas, índices 0..12 do layout).
const FII_ROW = [
    'HGLG11', 'Logística', '160,50', '8,5%', '9,2%', '0,98', '12.000.000.000',
    '5.000.000', '20', '1.200', '8,5', '7,8%', '3,2%',
];

describe('validateFundamentusLayout — AÇÕES', () => {
    it('aceita uma linha de dados válida', () => {
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW);
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
        const $ = buildTableMulti(FUNDAMENTUS_STOCKS_LAYOUT.table, [rowZeroPL, STOCK_ROW]);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(true);
    });

    it('shift real quebra TODAS as linhas → inválido', () => {
        // Coluna extra no início do corpo em ambas as linhas → ticker/preço deslocam.
        const r1 = ['LIXO', ...STOCK_ROW];
        const r2 = ['LIXO', ...STOCK_ROW];
        const $ = buildTableMulti(FUNDAMENTUS_STOCKS_LAYOUT.table, [r1, r2]);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
    });

    it('regressão: thead com coluna EXTRA mas tbody correto → ainda válido', () => {
        // Reproduz o bug real: cabeçalho diverge do corpo (ROIC aparece na col 16 do
        // header), mas a linha de dados segue correta. A validação por corpo não deve falsar.
        const headerComExtra = [
            'Papel', 'EXTRA', 'Cotação', 'P/L', 'P/VP', 'PSR', 'Div.Yield', 'P/Ativo',
            'P/Cap.Giro', 'P/EBIT', 'P/Ativ Circ.Liq', 'EV/EBIT', 'EV/EBITDA',
            'Mrg Ebit', 'Mrg. Líq.', 'Liq. Corr.', 'ROIC', 'ROE', 'Liq.2meses',
            'Patrim. Líq', 'Dív.Brut/ Patrim.', 'Cresc. Rec.5a',
        ];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW, headerComExtra);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(true);
        expect(res.mismatches).toHaveLength(0);
    });

    it('acusa divergência quando colunas saem do lugar (ticker no lugar do preço)', () => {
        // Insere uma coluna no início do CORPO → ticker e preço deslocam, invariantes quebram.
        const deslocada = ['LIXO', ...STOCK_ROW];
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, deslocada);
        const res = validateFundamentusLayout($, FUNDAMENTUS_STOCKS_LAYOUT);
        expect(res.ok).toBe(false);
        expect(res.mismatches.length).toBeGreaterThan(0);
    });

    it('acusa linha com menos colunas que o esperado (layout truncado)', () => {
        const $ = buildTable(FUNDAMENTUS_STOCKS_LAYOUT.table, STOCK_ROW.slice(0, 10));
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
        const $ = buildTable(FUNDAMENTUS_FIIS_LAYOUT.table, FII_ROW);
        const res = validateFundamentusLayout($, FUNDAMENTUS_FIIS_LAYOUT);
        expect(res.ok).toBe(true);
        expect(res.mismatches).toHaveLength(0);
    });

    it('acusa célula-chave inválida em linha de largura correta (preço zerado)', () => {
        // Linha completa (13 col) mas preço = 0 → positiveNumber falha. Isola o invariante
        // da checagem de largura.
        const ruim = [...FII_ROW];
        ruim[FUNDAMENTUS_FIIS_LAYOUT.columns.price] = '0';
        const $ = buildTable(FUNDAMENTUS_FIIS_LAYOUT.table, ruim);
        const res = validateFundamentusLayout($, FUNDAMENTUS_FIIS_LAYOUT);
        expect(res.ok).toBe(false);
    });
});
